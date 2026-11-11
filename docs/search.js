export const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
export const tokens = query => query.trim().split(/\s+/u).map(normalize).filter(Boolean);
const digit = /[0-9]/;
const alnum = /[a-z0-9]/;
const han = /\p{Script=Han}/u;
const formatMarks = /\((?:[_….·]*|[a-h]{1,8}|[√×✓✗])\)|[_…]+|[\p{P}\p{Cf}−·]/gu;

// Ignore layout punctuation and answer slots, but keep punctuation used in measurements and codes.
function relaxed(text, onRemove) {
 return text.replace(formatMarks,(mark,offset)=>{
  const left=text[offset-1]||'', right=text[offset+mark.length]||'';
  if((mark==='.'||mark===','||mark===':')&&digit.test(left)&&digit.test(right))return mark;
  if(mark==='.'&&!alnum.test(left)&&digit.test(right))return mark;
  if(/^[\-−‐‑–—]$/u.test(mark)&&(digit.test(right)||(alnum.test(left)&&alnum.test(right))))return '-';
  if((mark==='/'||mark==='·')&&alnum.test(left)&&alnum.test(right))return mark;
  if(mark==='%'||mark==='‰'||mark==='*')return mark;
  if(digit.test(left)&&digit.test(right))return mark; // Do not join separate numbers into one.
  onRemove?.(offset,mark.length);
  return '';
 });
}

const entryIndex = new WeakMap();
function relaxedEntry(entry) {
 let index=entryIndex.get(entry);
 if(index)return index;
 const stems=[],other=[];
 for(const block of entry.blocks){
  if(block.kind==='question'){
   stems.push(relaxed(normalize(block.stem)));
   other.push(...[...block.options.map(o=>o.text),block.answer,...block.notes].map(s=>relaxed(normalize(s))));
  }else{
   stems.push(...block.paragraphs.map(s=>relaxed(normalize(s))));
  }
 }
 index={stems,fields:[...stems,...other]};
 entryIndex.set(entry,index);
 return index;
}

function rankExact(pool, words, compact, allowPinyin = false) {
 const exact=[];
 for(const entry of pool){
  const text=entry.search.text;
  if(words.every(w=>text.includes(w)))exact.push({entry,kind:'text',score:(text.includes(compact)?200:100)+(normalize(entry.title).includes(compact)?40:0)});
  else if(allowPinyin&&words.every(w=>entry.search.pinyin.includes(w)||entry.search.initials.includes(w)))exact.push({entry,kind:'pinyin',score:60});
 }
 return exact.sort((a,b)=>b.score-a.score);
}

export function rank(entries, query, type = '全部') {
 const words=tokens(query), compact=normalize(query);
 const pool=entries.filter(e=>type==='全部'||e.type===type);
 if(!words.length)return pool.map(entry=>({entry,score:0}));
 const exact=rankExact(pool,words,compact,/^[a-z\s]+$/i.test(query));
 if(exact.length)return exact;

 // Pasted stems can start with a question number that is absent from the bank.
 const unnumbered=query.replace(/^(?:第\s*[0-9０-９]{1,5}\s*题\s*[:：]?|[0-9０-９]{1,5}\s*[.．、)）])\s*(?=[\p{Script=Han}《「“（(])/u,'');
 const folded=relaxed(normalize(unnumbered)), foldedWords=tokens(unnumbered).map(w=>relaxed(w)).filter(Boolean);
 if(folded){
  const matches=[];
  for(const entry of pool){
   const {stems,fields}=relaxedEntry(entry);
   const score=stems.includes(folded)?195:stems.some(s=>s.includes(folded))?180:
    fields.some(s=>s.includes(folded))?160:foldedWords.length>1&&foldedWords.every(w=>fields.some(s=>s.includes(w)))?95:0;
   if(score)matches.push({entry,score,kind:'format',matchedWords:score===95?foldedWords:[folded]});
  }
  if(matches.length)return matches.sort((a,b)=>b.score-a.score);
 }

 // Split mixed keywords at Han/ASCII boundaries and between a year and a standard prefix.
 const splitWords=words.flatMap(word=>/[0-9]/.test(word)
  ? word.replace(/(\p{Script=Han})(?=[a-z0-9])|([a-z0-9])(?=\p{Script=Han})/gu,'$1$2 ').split(' ')
  : [word]);
 const keywords=splitWords.flatMap(word=>word.replace(/^((?:19|20)\d{2})(?=(?:gb(?:\/[tz])?|jtg(?:\/t)?|jt\/t)(?:$|\d))/u,'$1 ').split(' '));
 if(keywords.length>words.length){
  const splitMatches=rankExact(pool,keywords,compact);
  if(splitMatches.length)return splitMatches.map(match=>({...match,matchedWords:keywords}));
 }

 return rankSimilar(pool,folded);
}

function grams(text,size){
 const counts=new Map();
 for(let i=0;i<=text.length-size;i++){
  const gram=text.slice(i,i+size);
  counts.set(gram,(counts.get(gram)||0)+1);
 }
 return counts;
}

function overlap(text,size,queryGrams){
 const found=new Map();
 let shared=0;
 for(let i=0;i<=text.length-size;i++){
  const gram=text.slice(i,i+size), max=queryGrams.get(gram);
  if(!max)continue;
  const count=found.get(gram)||0;
  if(count<max){found.set(gram,count+1);shared++;}
 }
 return shared;
}

const criticalPattern=/[a-z0-9.,:/+%‰*~×÷=<>≤≥±-]+|大于|小于|高于|低于|多于|少于|不少|至少|至多|最大|最小|最高|最低|正确|错误|严禁|禁止|[不未无非]/gu;
function criticalText(text){
 const fixed=new Uint8Array(text.length), terms=[];
 for(const match of text.matchAll(criticalPattern)){
  terms.push(match[0]);
  fixed.fill(1,match.index,match.index+match[0].length);
 }
 return {fixed,signature:terms.join('|')};
}

// Edit distance against a whole field or the best substring of a longer field.
// Technical values and meaning-changing qualifiers cannot be edited.
function editDistance(query,field,queryFixed,fieldFixed,whole){
 const n=field.length;
 let prev=new Float64Array(n+1), next=new Float64Array(n+1);
 if(whole){
  for(let j=1;j<=n;j++)prev[j]=fieldFixed[j-1]?Infinity:prev[j-1]+1;
 }
 for(let i=1;i<=query.length;i++){
  next[0]=queryFixed[i-1]?Infinity:prev[0]+1;
  for(let j=1;j<=n;j++){
   const fixedQuery=queryFixed[i-1], fixedField=fieldFixed[j-1];
   next[j]=Math.min(
    query[i-1]===field[j-1]?prev[j-1]:fixedQuery||fixedField?Infinity:prev[j-1]+1,
    fixedQuery?Infinity:prev[j]+1,
    fixedField?Infinity:next[j-1]+1,
   );
  }
  [prev,next]=[next,prev];
 }
 return whole?prev[n]:prev.reduce((best,distance)=>Math.min(best,distance),Infinity);
}

function rankSimilar(pool,query){
 const length=query.length;
 if(length<6||length>480||!han.test(query))return [];
 const budget=Math.min(8,Math.floor((length+1)/7));
 const bigrams=grams(query,2), trigrams=length>=22?grams(query,3):null;
 const queryCritical=criticalText(query);
 const matches=[];
 for(const entry of pool){
  let best=0;
  for(const stem of relaxedEntry(entry).stems){
   if(stem.length<length-budget)continue;
   const shared=overlap(stem,2,bigrams);
   if(shared<length-1-2*budget&&(!trigrams||shared<(length-2)*.8))continue;
   const whole=stem.length<=length+budget;
   const critical=criticalText(stem);
   const sameCritical=critical.signature===queryCritical.signature;
   if(whole&&!sameCritical)continue;
   if(shared>=length-1-2*budget){
    const distance=editDistance(query,stem,queryCritical.fixed,critical.fixed,whole);
    if(distance<=budget){
     const score=50-3*distance+2*shared/(length-1)+2*Math.min(1,length/stem.length)+(whole?2:0);
     best=Math.max(best,score);
     continue;
    }
   }
   // A rearranged sentence can still have most of the same three-character phrases.
   if(trigrams&&sameCritical&&stem.length<=length*1.25&&stem.length>=length*.8){
    const similarity=overlap(stem,3,trigrams)/(Math.max(length,stem.length)-2);
    if(similarity>=.8)best=Math.max(best,10+similarity);
   }
  }
  if(best)matches.push({entry,score:best,kind:'similar'});
 }
 return matches.sort((a,b)=>b.score-a.score).slice(0,12);
}
export function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
export function highlight(text,queryOrWords,ignoreFormat=false){
 const words=Array.isArray(queryOrWords)?queryOrWords:tokens(queryOrWords);
 if(!words.length)return escapeHtml(text);
 const raw=Array.from(String(text||'')), map=[], normalized=[];
 raw.forEach((ch,i)=>{for(const c of normalize(ch).split('')){normalized.push(c);map.push(i);}});
 let n=normalized.join(''), offsets=map;
 if(ignoreFormat){
  const removed=new Uint8Array(map.length);
  n=relaxed(n,(start,length)=>removed.fill(1,start,start+length));
  offsets=map.filter((_,i)=>!removed[i]);
 }
 const marked=new Set();
 for(const word of words){if(!word)continue;let pos=n.indexOf(word);while(pos!==-1){for(let j=offsets[pos];j<=offsets[pos+word.length-1];j++)marked.add(j);pos=n.indexOf(word,pos+word.length);}}
 let html='',open=false;
 raw.forEach((ch,i)=>{const hit=marked.has(i);if(hit!==open){html+=hit?'<mark>':'</mark>';open=hit;}html+=escapeHtml(ch);});
 return html+(open?'</mark>':'');
}
