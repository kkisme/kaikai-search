export const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
export const tokens = query => query.trim().split(/\s+/u).map(normalize).filter(Boolean);
export function rank(entries, query, type = '全部') {
 const words=tokens(query), compact=normalize(query);
 const pool=entries.filter(e=>type==='全部'||e.type===type);
 if(!words.length)return pool.map(entry=>({entry,score:0}));
 const exact=[];
 for(const entry of pool){
  const text=entry.search.text;
  if(words.every(w=>text.includes(w)))exact.push({entry,score:(text.includes(compact)?200:100)+(normalize(entry.title).includes(compact)?40:0)});
  else if(/^[a-z\s]+$/i.test(query)&&words.every(w=>entry.search.pinyin.includes(w)||entry.search.initials.includes(w)))exact.push({entry,score:60});
 }
 if(exact.length)return exact.sort((a,b)=>b.score-a.score);
 // Only fall back to bounded one-character typo matches when there are no exact results.
 if(words.length!==1||compact.length<3||compact.length>24||/^[a-z]+$/.test(compact))return [];
 return pool.filter(e=>nearMatch(e.search.text,compact)).map(entry=>({entry,score:10}));
}
function nearMatch(text, query){
 for(let start=0;start<=text.length-query.length;start++){
  let differences=0;
  for(let j=0;j<query.length;j++){if(text[start+j]!==query[j]&&++differences>1)break;}
  if(differences<=1)return true;
 }
 return false;
}
export function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
export function highlight(text,query){
 const raw=Array.from(String(text||'')), map=[], normalized=[];
 raw.forEach((ch,i)=>{for(const c of normalize(ch).split('')){normalized.push(c);map.push(i);}});
 const n=normalized.join(''),marked=new Set();
 for(const word of tokens(query)){let pos=n.indexOf(word);while(pos!==-1){for(let j=map[pos];j<=map[pos+word.length-1];j++)marked.add(j);pos=n.indexOf(word,pos+word.length);}}
 let html='',open=false;
 raw.forEach((ch,i)=>{const hit=marked.has(i);if(hit!==open){html+=hit?'<mark>':'</mark>';open=hit;}html+=escapeHtml(ch);});
 return html+(open?'</mark>':'');
}
