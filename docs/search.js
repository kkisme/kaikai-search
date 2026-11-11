export const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
export const tokens = query => query.trim().split(/\s+/u).map(normalize).filter(Boolean);
const digit = /[0-9]/;
const alnum = /[a-z0-9]/;
const han = /\p{Script=Han}/u;
const formatMarks = /\((?:[_….·]*|[a-h]{1,8}|[√×✓✗])\)|[_…]+|[\p{P}\p{Cf}−·∕⁄]/gu;

// Ignore layout punctuation and answer slots, but keep punctuation used in measurements and codes.
function relaxed(text, onRemove) {
 return text.replace(formatMarks,(mark,offset)=>{
  const left=text[offset-1]||'', right=text[offset+mark.length]||'';
  if((mark==='.'||mark===','||mark===':')&&digit.test(left)&&digit.test(right))return mark;
  if(mark==='.'&&!alnum.test(left)&&digit.test(right))return mark;
  if(/^[\-−‐‑–—]$/u.test(mark)&&(digit.test(right)||(alnum.test(left)&&alnum.test(right))))return '-';
  if((mark==='/'||mark==='∕'||mark==='⁄')&&alnum.test(left)&&alnum.test(right))return '/';
  if(mark==='·'&&alnum.test(left)&&alnum.test(right))return mark;
  if(mark==='%'||mark==='‰'||mark==='*')return mark;
  if(digit.test(left)&&digit.test(right))return mark; // Do not join separate numbers into one.
  onRemove?.(offset,mark.length);
  return '';
 });
}

const entryIndex = new WeakMap();
function searchField(value, main = false) {
 const literal=normalize(value);
 return {literal,folded:relaxed(literal),main};
}

function indexedEntry(entry) {
 let index=entryIndex.get(entry);
 if(index)return index;
 const stems=[],fields=[];
 for(const block of entry.blocks){
  if(block.kind==='question'){
   const stem=searchField(block.stem,true), options=block.options.map(o=>searchField(o.text));
   stem.options=new Set(options.map(option=>option.folded));
   stems.push(stem);
   fields.push(stem,...options,...[block.answer,...block.notes].filter(Boolean).map(value=>searchField(value)));
  }else{
   const material=block.paragraphs.map(value=>searchField(value,true));
   stems.push(...material);
   fields.push(...material);
  }
 }
 index={stems,fields,title:normalize(entry.title)};
 entryIndex.set(entry,index);
 return index;
}

const byScore=(a,b)=>b.score-a.score;
const questionType='(?:单项选择|多项选择|不定项选择|单选|多选|判断|填空|案例分析|案例|综合|简答)(?:题)?';
const numberPrefix=/^(?:第\s*\d{1,5}\s*题\s*[:.、]?|\[\s*\d{1,5}\s*\]|\(\s*\d{1,5}\s*\)|\d{1,5}\s*[.、)](?!\d))\s*/u;
const typePrefix=new RegExp(`^(?:[【\\[(]\\s*${questionType}\\s*[】\\])]|${questionType}\\s*:)\\s*`,'u');
const answerLabel='(?:参考|正确|标准|我的|你的|您的)?答案';
const metadataLabel=`(?:${answerLabel}|(?:答案|题目|试题)?解析|难度|分值)`;
const metadata=new RegExp(`(?:\\s+|(?<=[。!?]))(?:[【\\[]\\s*${metadataLabel}\\s*[】\\]]|${metadataLabel}\\s*:|${answerLabel}\\s+(?=[A-H]{1,8}(?![A-Za-z])|正确|错误|[√×]))`,'u');
const originalNumber=new RegExp(`\\s+原卷\\s*${questionType}\\s*第\\s*\\d+\\s*题(?=\\s|$)`,'gu');
const optionMarker=/(?:^|[\s。!?;])(?:([a-h])[.、:)]|\(([a-h])\)|\[([a-h])\])\s*(?=\S)/giu;

function parseQuery(query) {
 const input=query.trim().normalize('NFKC');
 // Allow a type label both before and after the number, including stems beginning with GB/JTG.
 const stemWithTail=input.replace(typePrefix,'').replace(numberPrefix,'').replace(typePrefix,'').replace(originalNumber,'');
 const tail=stemWithTail.search(metadata);
 const text=(tail<0?stemWithTail:stemWithTail.slice(0,tail)).trim();
 const markers=[...text.matchAll(optionMarker)];
 // A filled answer slot such as (C) may occur in the stem before the real A/B/C labels.
 const keys=new Set();
 for(let i=markers.length-1;i>=0;i--){
  const key=(markers[i][1]||markers[i][2]||markers[i][3]).toLowerCase();
  if(keys.has(key)){markers.splice(0,i+1);break;}
  keys.add(key);
 }
 const first=markers[0]?.index;
 if(first>0&&markers.length>=2){
  const options=new Set(markers.map((marker,i)=>relaxed(normalize(
   text.slice(marker.index+marker[0].length,markers[i+1]?.index)
  ))).filter(Boolean));
  if(options.size)return {text:text.slice(0,first).trim(),options,pasted:true,cleaned:true};
 }
 return {text:text||input,options:new Set(),pasted:tail>0,cleaned:input!==(text||input)};
}

function keywords(text) {
 const terms=tokens(text.replace(/\b((?:GB(?:\/[TZ])?|JTG(?:\/T)?|JT\/T|JGJ(?:\/T)?))\s+(?=\d)/gi,'$1')
  .replace(/[、;|]+|(?<!\d),|,(?!\d)/gu,' '));
 // Compact mixed keywords can include a year and code; don't split long question stems.
 if(normalize(text).length>32)return terms;
 return terms.flatMap(word=>/\d/.test(word)
  ? word.replace(/(\p{Script=Han})(?=[a-z0-9])|([a-z0-9])(?=\p{Script=Han})/gu,'$1$2 ')
   .replace(/\b((?:19|20)\d{2})(?=(?:gb(?:\/[tz])?|jtg(?:\/t)?|jt\/t)(?:\b|\d))/gu,'$1 ').split(' ')
  : [word]);
}

function phraseMatch(field, phrase) {
 if(field.literal===phrase.literal)return [field.main?510:310,false];
 if(phrase.folded&&field.folded===phrase.folded)return [field.main?500:300,true];
 if(field.literal.includes(phrase.literal))return [field.main?450:270,false];
 if(phrase.folded&&field.folded.includes(phrase.folded))return [field.main?440:260,true];
 return [0,false];
}

function termMatch(fields, term) {
 let best=0;
 for(const field of fields){
  if(field.literal.includes(term.literal))best=Math.max(best,field.main?4:2);
  else if(term.folded&&field.folded.includes(term.folded))best=Math.max(best,field.main?3:1);
  if(best===4)break;
 }
 return best;
}

function optionMatches(field, options) {
 let count=0;
 if(field.options)for(const option of options)if(field.options.has(option))count++;
 return count;
}

function rankText(pool, phrase, terms, parsed) {
 const results=[];
 const pinyin=!parsed.pasted&&/^[a-z\s]+$/.test(parsed.text.toLowerCase());
 for(const entry of pool){
  const {stems,fields,title}=indexedEntry(entry);
  let score=0, format=false, matched=phrase;
  for(const field of parsed.pasted?stems:fields){
   const [value,folded]=phraseMatch(field,phrase);
   if(!value)continue;
   const weighted=value+optionMatches(field,parsed.options)*18;
   if(weighted>score){score=weighted;format=folded;}
  }
  if(score<400&&!parsed.pasted&&terms.length>1){
   const hits=terms.map(term=>termMatch(fields,term));
   if(hits.every(Boolean)){
    const base=hits.every(hit=>hit>=3)?400:100;
    const weighted=base+hits.reduce((sum,hit)=>sum+hit,0)/hits.length;
    if(weighted>score){
     score=weighted;
     format=hits.some(hit=>hit%2===1);
     matched=terms;
    }
   }
  }
  if(score){
   const ignoreFormat=format||parsed.cleaned;
   const matchedWords=(Array.isArray(matched)?matched:[matched]).map(term=>ignoreFormat?term.folded:term.literal);
   results.push({entry,score:score+(title.includes(phrase.literal)?1:0),kind:ignoreFormat?'format':'text',matchedWords});
  }else if(pinyin&&terms.every(({literal})=>entry.search.pinyin.includes(literal)||entry.search.initials.includes(literal))){
   results.push({entry,score:60,kind:'pinyin'});
  }
 }
 return results.sort(byScore);
}

export function rank(entries, query, type = '全部') {
 const pool=entries.filter(e=>type==='全部'||e.type===type);
 if(!query.trim())return pool.map(entry=>({entry,score:0}));
 const parsed=parseQuery(query);
 const phrase=searchField(parsed.text);
 // A complete stem must not match because one of its numbers appears in an unrelated option or note.
 const sentence=phrase.literal.length>=24&&(/[。!?]$/u.test(phrase.literal)||/_{2,}|\(\)/u.test(phrase.literal));
 const terms=parsed.pasted||sentence?[]:keywords(parsed.text).map(word=>searchField(word));
 const matches=rankText(pool,phrase,terms,parsed);
 if(matches.length)return matches;
 const similar=rankSimilar(pool,phrase.folded,parsed.options);
 if(similar.length||parsed.pasted)return similar;
 return rankSimilarKeywords(pool,terms);
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

function similarQuery(query,minLength=4){
 const length=query.length;
 if(length<minLength||length>480||!han.test(query))return null;
 return {query,budget:Math.max(1,Math.min(8,Math.floor((length+1)/7))),
  bigrams:grams(query,2),trigrams:length>=22?grams(query,3):null,critical:criticalText(query)};
}

function similarScore(field, spec){
 const {query,budget,bigrams,trigrams,critical}=spec, length=query.length, stem=field.folded;
 if(stem.length<length-budget)return 0;
 const shared=overlap(stem,2,bigrams), minShared=length-1-2*budget;
 if(shared<minShared&&(!trigrams||shared<(length-2)*.8))return 0;
 const whole=stem.length<=length+budget;
 const fieldCritical=field.critical??=criticalText(stem);
 const sameCritical=fieldCritical.signature===critical.signature;
 if(whole&&!sameCritical)return 0;
 if(shared>=minShared){
  const distance=editDistance(query,stem,critical.fixed,fieldCritical.fixed,whole);
  if(distance<=budget)return 50-3*distance+2*shared/(length-1)+2*Math.min(1,length/stem.length)+(whole?2:0);
 }
 // A rearranged sentence can still have most of the same three-character phrases.
 if(trigrams&&sameCritical&&stem.length<=length*1.25&&stem.length>=length*.8){
  const similarity=overlap(stem,3,trigrams)/(Math.max(length,stem.length)-2);
  if(similarity>=.8)return 10+similarity;
 }
 return 0;
}

function rankSimilar(pool,query,options){
 const spec=similarQuery(query);
 if(!spec)return [];
 const matches=[];
 for(const entry of pool){
  let best=0;
  for(const field of indexedEntry(entry).stems){
   const score=similarScore(field,spec);
   if(score)best=Math.max(best,score+optionMatches(field,options));
  }
  if(best)matches.push({entry,score:best,kind:'similar'});
 }
 return matches.sort(byScore).slice(0,12);
}

// Only one keyword may contain a typo; all other words must be present in the same entry.
function rankSimilarKeywords(pool,terms){
 if(terms.length<2||terms.length>6||terms.some(term=>!term.folded||term.folded.length>24))return [];
 const specs=terms.map((term,i)=>{
  const anchored=terms.some((other,j)=>i!==j&&other.folded.length>=2&&han.test(other.folded));
  return similarQuery(term.folded,anchored?3:4);
 });
 if(!specs.some(Boolean))return [];
 const matches=[];
 for(const entry of pool){
  const {stems,fields}=indexedEntry(entry);
  let missing=-1, anchors=0;
  for(let i=0;i<terms.length;i++){
   const hit=termMatch(fields,terms[i]);
   if(hit)anchors+=hit;
   else if(missing!==-1||!specs[i]){missing=-1;break;}
   else missing=i;
  }
  if(missing===-1)continue;
  let best=0;
  for(const field of stems)best=Math.max(best,similarScore(field,specs[missing]));
  if(best)matches.push({entry,score:best+anchors/terms.length,kind:'similar'});
 }
 return matches.sort(byScore).slice(0,12);
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
