import {rank, highlight, highlightRanges, escapeHtml} from './search.js?v=20261111-shuffled-options';
const $ = id => document.getElementById(id);
const types = ['全部','单选','多选','判断','填空','案例题','知识卡'];
const banks = new Map([...document.querySelectorAll('.bank-row')].map(row=>[row.hash,{
 row, name:row.querySelector('.bank-title').textContent, file:row.dataset.file,
 entries:null, query:'', type:'全部', loading:false, failed:false,
}]));
let activeBank;
let entries = [], query = '', type = '全部', limit = 30, resultCards = [], active = -1;
let debounce, composing = false;
function badge(type) { return `<span class="badge">${escapeHtml(type)}</span>`; }
function questionHtml(b, index, grouped, label, highlightStem, highlightDetails) {
 const keys = b.answer.trim().match(/^[A-H]+(?=$|[（(])/u)?.[0] || '';
 return `<section class="question" data-question-id="${escapeHtml(b.id)}">
 <p class="stem">${badge(label || b.type)}${grouped ? `<span class="sub-number">${index}.</span>` : ''}${highlightStem(b.stem)}</p>
 ${b.options.length ? `<ul class="options">${b.options.map(o=>`<li class="${keys.includes(o.key)?'correct':''}"><span class="option-key">${escapeHtml(o.key)}.</span><span>${highlightDetails(o.text)}</span></li>`).join('')}</ul>` : ''}
 ${b.answer ? `<div class="answer">答案：<strong>${highlightDetails(b.answer)}</strong></div>` : ''}
 ${b.notes.length ? `<div class="note">${b.notes.map(n=>`<p>${highlightDetails(n)}</p>`).join('')}</div>` : ''}</section>`;
}
function entryHtml(e, highlightStem, highlightDetails=highlightStem) {
 const grouped=e.blocks.filter(b=>b.kind==='question').length>1||e.type==='案例题';
 let index=0, first=true;
 return `<article class="entry ${grouped?'case-entry':''}" data-entry-id="${escapeHtml(e.id)}">${e.blocks.map(b=>{
  const label=first?e.type:'';first=false;
  if(b.kind==='question')return questionHtml(b,++index,grouped,label,highlightStem,highlightDetails);
  return `<section class="material">${b.paragraphs.map((p,i)=>`<p>${i===0&&label?badge(label):''}${highlightStem(p)}</p>`).join('')}</section>`;
 }).join('')}</article>`;
}
function updateNavigation() {
 $('matchNav').hidden=!query||$('searchView').hidden;
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
 $('list').innerHTML=visible.map(({entry,kind,matchedWords,similarHighlights})=>{
  if(kind==='similar')return entryHtml(entry,value=>highlightRanges(value,similarHighlights?.get(value)??[]),escapeHtml);
  const highlightValue=kind==='pinyin'?escapeHtml:value=>highlight(value,matchedWords??query,kind==='format');
  return entryHtml(entry,highlightValue);
 }).join('')||'<p class="empty">没有找到匹配题目，可用题干里的几个关键词重试，或切换题型。</p>';
 if(reset){
  $('list').classList.remove('list-enter');
  requestAnimationFrame(()=>$('list').classList.add('list-enter'));
 }
 const exhausted=visible.length>=results.length;
 $('loadSentinel').hidden=exhausted;
 $('searchEnd').hidden=!exhausted;
 resultCards=[...$('list').querySelectorAll('.entry')];
 active=resultCards.length?0:-1;updateNavigation();
 const matchKind=results[0]?.kind;
 const label=matchKind==='similar'?' · 近似匹配，请核对题干':matchKind==='pinyin'?' · 拼音匹配':'';
 $('stat').textContent=`${query?'找到':'共'} ${results.length} 条${query?label:` · 已展示 ${visible.length} 条`}`;
 if(reset&&!$('searchView').hidden)window.scrollTo({top:0,behavior:'instant'});
}
function syncClearButton(){$('clearSearch').hidden=!$('searchInput').value;}
function search(){
 clearTimeout(debounce);
 syncClearButton();
 if(!activeBank)return;
 activeBank.query=$('searchInput').value.trim();
 if(!activeBank.entries)return;
 query=activeBank.query;
 limit=30;
 render();
}
$('searchForm').addEventListener('submit',e=>{e.preventDefault();composing=false;search();});
$('searchInput').addEventListener('compositionstart',()=>{composing=true;clearTimeout(debounce);});
$('searchInput').addEventListener('compositionend',()=>{composing=false;search();});
$('searchInput').addEventListener('input',()=>{syncClearButton();if(!composing){clearTimeout(debounce);debounce=setTimeout(search,180);}});
$('searchInput').addEventListener('paste',event=>{
 const text=event.clipboardData?.getData('text/plain');
 if(!text||!/[\r\n\u2028\u2029]/u.test(text))return;
 // A search input drops line breaks. Preserve boundaries between the stem and options.
 event.preventDefault();
 const input=event.currentTarget;
 input.setRangeText(text.replace(/[\r\n\u2028\u2029]+/gu,' '),input.selectionStart,input.selectionEnd,'end');
 input.dispatchEvent(new Event('input',{bubbles:true}));
});
$('clearSearch').addEventListener('click',()=>{$('searchInput').value='';search();$('searchInput').focus();});
new IntersectionObserver(items=>{
 if(items.some(item=>item.isIntersecting)&&!$('loadSentinel').hidden){limit+=30;render(false);}
},{rootMargin:'360px 0px'}).observe($('loadSentinel'));
$('prevMatch').addEventListener('click',()=>moveMatch(-1));
$('nextMatch').addEventListener('click',()=>moveMatch(1));
new ResizeObserver(()=>document.documentElement.style.setProperty('--header-height',`${$('header').offsetHeight}px`)).observe($('header'));
function showView() {
 const bank=banks.get(location.hash);
 const searching=Boolean(bank);
 document.title=bank?`${bank.name} · 凯凯搜题助手`:'凯凯搜题助手';
 $('homeView').hidden=searching;
 $('searchView').hidden=!searching;
 if(bank&&bank!==activeBank){
  clearTimeout(debounce);
  composing=false;
  activeBank=bank;
  $('currentBankName').textContent=bank.name;
  $('currentBankName').title=bank.name;
  $('searchInput').value=bank.query;
  showBank(bank);
 }
 updateNavigation();
 const view=$(searching?'searchView':'homeView');
 view.classList.remove('view-enter');
 requestAnimationFrame(()=>view.classList.add('view-enter'));
 document.body.classList.toggle('on-home',!searching);
 window.scrollTo({top:0,behavior:'instant'});
}
window.addEventListener('hashchange',showView);
showView();
const qqLink = document.querySelector('.qq-link');
const isMobile = navigator.userAgentData?.mobile || /Android|iPhone|iPad|iPod/.test(navigator.userAgent)
 || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
if(!isMobile)qqLink.href=qqLink.dataset.desktopHref;
for(const trigger of document.querySelectorAll('.guide-trigger')){
 const dialog=$(trigger.getAttribute('aria-controls'));
 trigger.addEventListener('click',()=>dialog.showModal());
 dialog.querySelector('.guide-close').addEventListener('click',()=>dialog.close());
 dialog.addEventListener('click',event=>{
  const bounds=dialog.getBoundingClientRect();
  if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)dialog.close();
 });
}
$('typeFilters').onclick=event=>{
 const button=event.target.closest('button');
 if(!button)return;
 type=activeBank.type=button.dataset.type;
 for(const item of $('typeFilters').children)item.setAttribute('aria-pressed',String(item===button));
 search();
};
function showBank(bank){
 entries=bank.entries||[];
 type=bank.type;
 const available=new Set(entries.map(entry=>entry.type));
 $('typeFilters').innerHTML=bank.entries?types.filter(t=>t==='全部'||available.has(t))
  .map(t=>`<button type="button" data-type="${t}" aria-pressed="${t===type}">${t}</button>`).join(''):'';
 if(bank.entries){search();return;}
 query='';
 resultCards=[];
 active=-1;
 syncClearButton();
 updateNavigation();
 $('loadSentinel').hidden=true;
 $('searchEnd').hidden=true;
 $('stat').textContent=bank.failed?'题库加载失败，请检查网络后重试。':'正在加载最新题库…';
 $('list').innerHTML=bank.failed?'<p class="empty"><button id="retry">重新加载题库</button></p>':'';
 if(bank.failed)$('retry').onclick=()=>loadBank(bank);
}
function updateHomeStatus(){
 const failed=[...banks.values()].filter(bank=>bank.failed);
 $('homeRetry').hidden=!failed.length;
 $('homeStatus').textContent=failed.length?`${failed.map(bank=>bank.name).join('、')}加载失败，请检查网络后重试。`:'';
}
async function loadBank(bank){
 if(bank.entries||bank.loading)return;
 bank.loading=true;
 bank.failed=false;
 const count=bank.row.querySelector('.bank-count');
 count.textContent='正在加载…';
 updateHomeStatus();
 if(bank===activeBank)showBank(bank);
 try{
  const response=await fetch(`./${bank.file}`);
  if(!response.ok)throw new Error(`HTTP ${response.status}`);
  const data=await response.json();
  if(data.schemaVersion!==4||!Array.isArray(data.entries))throw new Error('题库格式不兼容');
  bank.entries=data.entries.map(e=>({...e,type:['案例','综合'].includes(e.type)?'案例题':e.type==='案例资料'?'知识卡':e.type}));
  count.textContent=`${bank.entries.length} 道`;
  const date=bank.row.querySelector('time');
  date.textContent=date.dateTime=data.generatedDate||'';
 }catch(error){
  bank.failed=true;
  count.textContent='加载失败';
  console.error(bank.name,error);
 }finally{
  bank.loading=false;
  updateHomeStatus();
  if(bank===activeBank)showBank(bank);
 }
}
function loadBanks(){for(const bank of banks.values())loadBank(bank);}
$('homeRetry').onclick=loadBanks;
loadBanks();
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
