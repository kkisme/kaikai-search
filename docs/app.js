import {rank, highlight, escapeHtml} from './search.js';
const $ = id => document.getElementById(id);
const types = ['全部','单选','多选','判断','案例题','知识卡'];
let entries = [], query = '', type = '全部', limit = 30, resultCards = [], active = -1;
let debounce, composing = false;
const h = value => highlight(value, query);
function badge(type) { return `<span class="badge">${escapeHtml(type)}</span>`; }
function questionHtml(b, index, grouped, label) {
 const keys = b.answer.trim().match(/^[A-H]+(?=$|[（(])/u)?.[0] || '';
 return `<section class="question" data-question-id="${escapeHtml(b.id)}">
 <p class="stem">${badge(label || b.type)}${grouped ? `<span class="sub-number">${index}.</span>` : ''}${h(b.stem)}</p>
 ${b.options.length ? `<ul class="options">${b.options.map(o=>`<li class="${keys.includes(o.key)?'correct':''}"><span class="option-key">${o.key}.</span><span>${h(o.text)}</span></li>`).join('')}</ul>` : ''}
 ${b.answer ? `<div class="answer">答案：<strong>${h(b.answer)}</strong></div>` : ''}
 ${b.notes.length ? `<div class="note">${b.notes.map(n=>`<p>${h(n)}</p>`).join('')}</div>` : ''}</section>`;
}
function entryHtml(e) {
 const grouped=e.blocks.filter(b=>b.kind==='question').length>1||e.type==='案例题';
 let index=0, first=true;
 return `<article class="entry ${grouped?'case-entry':''}" data-entry-id="${e.id}">${e.blocks.map(b=>{
  const label=first?e.type:'';first=false;
  if(b.kind==='question')return questionHtml(b,++index,grouped,label);
  return `<section class="material">${b.paragraphs.map((p,i)=>`<p>${i===0&&label?badge(label):''}${h(p)}</p>`).join('')}</section>`;
 }).join('')}</article>`;
}
function updateNavigation() {
 $('matchNav').hidden=!query;
 $('matchCount').textContent=`${active+1} / ${resultCards.length} 题`;
 $('prevMatch').disabled=active<=0;
 $('nextMatch').disabled=active<0||active>=resultCards.length-1;
 $('list').querySelector('.active-entry')?.classList.remove('active-entry');
 resultCards[active]?.classList.add('active-entry');
}
function moveMatch(delta) {
 const next=active+delta;
 if(next<0||next>=resultCards.length)return;
 active=next;
 const target=resultCards[active];
 updateNavigation();
 target.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
}
function render(reset=true) {
 const results=rank(entries,query,type), visible=query?results:results.slice(0,limit);
 $('list').innerHTML=visible.map(({entry})=>entryHtml(entry)).join('')||'<p class="empty">没有找到匹配题目，请缩短关键词或切换题型。</p>';
 if(reset){
  $('list').classList.remove('list-enter');
  requestAnimationFrame(()=>$('list').classList.add('list-enter'));
 }
 const exhausted=visible.length>=results.length;
 $('loadSentinel').hidden=exhausted;
 $('searchEnd').hidden=!exhausted;
 resultCards=[...$('list').querySelectorAll('.entry')];
 active=resultCards.length?0:-1;updateNavigation();
 const fuzzy=results.length&&results.every(r=>r.score===10);
 $('stat').textContent=`${query?'找到':'共'} ${results.length} 条${query?'':` · 已展示 ${visible.length} 条`}${fuzzy?' · 以下为近似匹配':query&&results.length&&!$('list').querySelector('mark')?' · 拼音匹配':''}`;
 if(reset)window.scrollTo({top:0,behavior:'instant'});
}
function syncClearButton(){$('clearSearch').hidden=!$('searchInput').value;}
function search(){clearTimeout(debounce);query=$('searchInput').value.trim();syncClearButton();limit=30;render();}
$('searchForm').addEventListener('submit',e=>{e.preventDefault();composing=false;search();});
$('searchInput').addEventListener('compositionstart',()=>{composing=true;clearTimeout(debounce);});
$('searchInput').addEventListener('compositionend',()=>{composing=false;search();});
$('searchInput').addEventListener('input',()=>{syncClearButton();if(!composing){clearTimeout(debounce);debounce=setTimeout(search,180);}});
$('clearSearch').addEventListener('click',()=>{$('searchInput').value='';search();$('searchInput').focus();});
new IntersectionObserver(items=>{
 if(items.some(item=>item.isIntersecting)&&!$('loadSentinel').hidden){limit+=30;render(false);}
},{rootMargin:'360px 0px'}).observe($('loadSentinel'));
$('prevMatch').addEventListener('click',()=>moveMatch(-1));
$('nextMatch').addEventListener('click',()=>moveMatch(1));
new ResizeObserver(()=>document.documentElement.style.setProperty('--header-height',`${$('header').offsetHeight}px`)).observe($('header'));
function showView() {
 const searching=location.hash==='#search';
 document.title=searching?'交安复习题 · 凯凯搜题助手':'凯凯搜题助手';
 $('homeView').hidden=searching;
 $('searchView').hidden=!searching;
 const view=$(searching?'searchView':'homeView');
 view.classList.remove('view-enter');
 requestAnimationFrame(()=>view.classList.add('view-enter'));
 document.body.classList.toggle('on-home',!searching);
 window.scrollTo({top:0,behavior:'instant'});
}
window.addEventListener('hashchange',showView);
showView();
const installGuide=$('installGuide');
$('guideTrigger').onclick=()=>installGuide.showModal();
$('guideClose').onclick=()=>installGuide.close();
installGuide.addEventListener('click',event=>{
 const bounds=installGuide.getBoundingClientRect();
 if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)installGuide.close();
});
$('homeRetry').onclick=loadBank;
async function loadBank(){
 $('homeRetry').hidden=true;
 $('homeStatus').textContent='';
 try{
  const response=await fetch('./question-bank.json');
  if(!response.ok)throw new Error(`HTTP ${response.status}`);
  const bank=await response.json();
  if(bank.schemaVersion!==4||!Array.isArray(bank.entries))throw new Error('题库格式不兼容');
  entries=bank.entries.map(e=>({...e,type:['案例','综合'].includes(e.type)?'案例题':e.type==='案例资料'?'知识卡':e.type}));
  $('bankCount').textContent=`${entries.length} 道`;
  $('bankDate').textContent=bank.generatedDate||'';
  $('bankDate').dateTime=bank.generatedDate||'';
  $('typeFilters').innerHTML=types.map(t=>`<button type="button" data-type="${t}" aria-pressed="${t===type}">${t}</button>`).join('');
  $('typeFilters').onclick=e=>{const button=e.target.closest('button');if(!button)return;type=button.dataset.type;for(const item of $('typeFilters').children)item.setAttribute('aria-pressed',String(item===button));search();};
  search();
 }catch(error){$('bankCount').textContent='加载失败';$('homeStatus').textContent='题库加载失败，请检查网络后重试。';$('homeRetry').hidden=false;$('stat').textContent='题库加载失败，请检查网络后重试。';$('list').innerHTML='<p class="empty"><button id="retry">重新加载题库</button></p>';$('retry').onclick=loadBank;console.error(error);}
}
loadBank();
if('serviceWorker' in navigator&&/^https?:$/.test(location.protocol)){
 const updating=Boolean(navigator.serviceWorker.controller);
 let reloading=false;
 if(updating)navigator.serviceWorker.addEventListener('controllerchange',()=>{
  if(reloading)return;
  reloading=true;
  location.reload();
 });
 navigator.serviceWorker.register('./sw.js').catch(error=>console.warn('离线缓存未启用',error));
}
