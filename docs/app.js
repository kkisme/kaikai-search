import {rank, highlight, escapeHtml} from './search.js';
const $ = id => document.getElementById(id);
const types = ['全部','单选','多选','判断','案例','综合','知识卡','案例资料'];
let entries = [], query = '', type = '全部', limit = 30, hits = [], active = -1;
let debounce, composing = false;
const h = value => highlight(value, query);
function questionHtml(b, index, grouped) {
 const show = $('showAnswers').checked;
 const keys = /^[A-H]+$/.test(b.answer.trim()) ? b.answer.trim() : '';
 return `<section class="question" data-question-id="${escapeHtml(b.id)}">
 ${grouped ? `<div class="sub-head"><span class="sub-number">${index}</span>小题 · ${escapeHtml(b.type)}</div>` : ''}
 <p class="stem">${h(b.stem)}</p>
 ${b.options.length ? `<ul class="options">${b.options.map(o=>`<li class="${show&&keys.includes(o.key)?'correct':''}"><span class="option-key">${o.key}.</span><span>${h(o.text)}</span></li>`).join('')}</ul>` : ''}
 ${b.answer ? `<details class="answer" ${show?'open':''}><summary>参考答案</summary><p>${h(b.answer)}</p></details>` : ''}
 ${b.notes.length ? `<div class="note">${b.notes.map(n=>`<p>${h(n)}</p>`).join('')}</div>` : ''}</section>`;
}
function entryHtml(e) {
 const count=e.blocks.filter(b=>b.kind==='question').length;
 const grouped=count>1||['案例','综合'].includes(e.type);
 let index=0, materialIndex=0;
 return `<article class="entry" data-entry-id="${e.id}"><div class="entry-head"><span class="badge">${escapeHtml(e.type)}</span><span>原题号 ${escapeHtml(e.sourceNo)}</span><small>${grouped?`${count} 道小题`:''}</small></div>
 ${e.section?`<div class="source-section">${escapeHtml(e.section)}</div>`:''}
 ${e.blocks.map(b=>b.kind==='question'?questionHtml(b,++index,grouped):`<section class="material">${grouped&&materialIndex++===0?'<div class="case-heading">案例背景 / 材料</div>':''}${b.paragraphs.map(p=>`<p>${h(p)}</p>`).join('')}</section>`).join('')}</article>`;
}
function updateNavigation() {
 $('matchNav').hidden=!query;
 $('matchCount').textContent=`${active+1} / ${hits.length}`;
 $('prevMatch').disabled=active<=0;
 $('nextMatch').disabled=active<0||active>=hits.length-1;
 $('list').querySelector('.active-match')?.classList.remove('active-match');
 hits[active]?.classList.add('active-match');
}
function moveMatch(delta) {
 const next=active+delta;
 if(next<0||next>=hits.length)return;
 active=next;
 const target=hits[active];
 for(let node=target.parentElement;node;node=node.parentElement)if(node.tagName==='DETAILS')node.open=true;
 updateNavigation();
 target.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
}
function render(reset=true) {
 const results=rank(entries,query,type), visible=query?results:results.slice(0,limit);
 $('list').innerHTML=visible.map(({entry})=>entryHtml(entry)).join('')||'<p class="empty">没有找到匹配题目，请缩短关键词或切换题型。</p>';
 $('more').hidden=visible.length>=results.length;
 hits=[...$('list').querySelectorAll('mark')];
 for(const hit of hits){const answer=hit.closest('details');if(answer)answer.open=true;}
 active=hits.length?0:-1;updateNavigation();
 const fuzzy=results.length&&results.every(r=>r.score===10);
 $('stat').textContent=`${query?'找到':'共'} ${results.length} 道大题 / 独立条目${query?` · ${hits.length} 处关键词`:` · 已展示 ${visible.length} 条`}${fuzzy?' · 以下为近似匹配':query&&results.length&&!hits.length?' · 拼音匹配':''}`;
 if(reset)window.scrollTo({top:0,behavior:'instant'});
}
function search(){clearTimeout(debounce);query=$('searchInput').value.trim();limit=30;render();}
$('searchForm').addEventListener('submit',e=>{e.preventDefault();if(!composing)search();});
$('searchInput').addEventListener('compositionstart',()=>{composing=true;clearTimeout(debounce);});
$('searchInput').addEventListener('compositionend',()=>{composing=false;search();});
$('searchInput').addEventListener('input',()=>{if(!composing){clearTimeout(debounce);debounce=setTimeout(search,180);}});
$('more').addEventListener('click',()=>{limit+=30;render(false);});
$('prevMatch').addEventListener('click',()=>moveMatch(-1));
$('nextMatch').addEventListener('click',()=>moveMatch(1));
$('showAnswers').addEventListener('change',()=>render(false));
new ResizeObserver(()=>document.documentElement.style.setProperty('--header-height',`${$('header').offsetHeight}px`)).observe($('header'));
async function loadBank(){
 try{
  const response=await fetch('./question-bank.json');
  if(!response.ok)throw new Error(`HTTP ${response.status}`);
  const bank=await response.json();
  if(bank.schemaVersion!==4||!Array.isArray(bank.entries))throw new Error('题库格式不兼容');
  entries=bank.entries;
  $('typeFilters').innerHTML=types.map(t=>`<button type="button" data-type="${t}" aria-pressed="${t===type}">${t} ${t==='全部'?entries.length:entries.filter(e=>e.type===t).length}</button>`).join('');
  $('typeFilters').onclick=e=>{const button=e.target.closest('button');if(!button)return;type=button.dataset.type;for(const item of $('typeFilters').children)item.setAttribute('aria-pressed',String(item===button));search();};
  search();
 }catch(error){$('stat').textContent='题库加载失败，请检查网络后重试。';$('list').innerHTML='<p class="empty"><button id="retry">重新加载题库</button></p>';$('retry').onclick=loadBank;console.error(error);}
}
loadBank();
if('serviceWorker' in navigator&&/^https?:$/.test(location.protocol))navigator.serviceWorker.register('./sw.js').catch(error=>console.warn('离线缓存未启用',error));
