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
 return {source:value,literal,folded:relaxed(literal),main};
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
const questionTypes='(?:单项选择|多项选择|不定项选择|单选|多选|判断|填空|案例分析|案例|综合|简答)';
const questionType=`${questionTypes}(?:题)?`;
const numberPrefix=new RegExp(String.raw`^(?:第\s*\d{1,5}\s*题\s*[:.、]?|[【\[(]\s*(?:第\s*)?\d{1,5}\s*(?:题\s*)?[】\])]|题号\s*:\s*\d{1,5}(?!\d)\s*[:.、)]?|\d{1,5}\s*[.、)](?!\d)|\d{1,5}(?=[ \t]*(?:\r?\n)|\s+${questionTypes}题(?:\s|:)))\s*`,'u');
const typePrefix=new RegExp(String.raw`^(?:[【\[(]\s*${questionType}\s*[】\])]|${questionType}\s*:|${questionTypes}题(?=\s))\s*`,'u');
const answerLabel='(?:(?:参考|正确|标准|我的|你的|您的)?答案|正确选项)';
const answerValue='(?:[a-h]{1,8}(?![a-z])|正确|错误|[√×])';
const metadataLabel=`(?:${answerLabel}|(?:答案|题目|试题)?解析|难度|分值)`;
const metadata=new RegExp(String.raw`(?:\s+|(?<=[。!?]))(?:[【\[]\s*${metadataLabel}\s*[】\]]|${metadataLabel}\s*:|${answerLabel}\s*(?=${answerValue}(?:[\s(,.;:。!?]|$)))`,'iu');
const compactAnswer=new RegExp(String.raw`${answerLabel}\s*(?::|(?=${answerValue}(?:\s*\([^)]*\))?\s*$))`,'iu');
const originalNumber=new RegExp(`\\s+原卷\\s*${questionType}\\s*第\\s*\\d+\\s*题(?=\\s|$)`,'gu');
const choiceLabel=String.raw`(?:([A-H])[.、:)]|\(([A-H])\)|\[([A-H])\])`;
// Some exports show a display label and an original label side by side (for example, A. D.).
const printedChoice=String.raw`${choiceLabel}(?:[ \t]+(?:[A-H][.、:)]|\([A-H]\)|\[[A-H]\])(?=[ \t]))?`;
const optionMarker=new RegExp(String.raw`(?:^|[\s。!?;,、])${printedChoice}\s*(?=\S)`,'giu');
const compactOptionMarker=new RegExp(String.raw`(?<![A-Za-z])${printedChoice}\s*(?=\S)`,'gu');
const bareOptionMarker=/(?:^|[\s。!?;,、])([A-H])\s+(?=\S)/gu;

function optionKey(marker){
 return (marker[1]||marker[2]||marker[3]).toUpperCase();
}

// Weaker separators are allowed only when a sequence of labels clearly identifies the options.
function sequentialOptionMarkers(text,pattern){
 let best=[], current=[];
 for(const marker of text.matchAll(pattern)){
  if(optionKey(marker)==='A'&&marker.index>0)current=[marker];
  else if(current.length&&optionKey(marker)===String.fromCharCode(65+current.length))current.push(marker);
  else current=[];
  if(current.length>=3&&current.length>best.length)best=[...current];
 }
 return best;
}

function pastedOptions(text){
 let markers=[...text.matchAll(optionMarker)];
 // A filled answer slot such as (C) may occur in the stem before the real A/B/C labels.
 const keys=new Set();
 for(let i=markers.length-1;i>=0;i--){
  const key=optionKey(markers[i]);
  if(keys.has(key)){markers.splice(0,i+1);break;}
  keys.add(key);
 }
 for(const pattern of [compactOptionMarker,bareOptionMarker]){
  const alternative=sequentialOptionMarkers(text,pattern);
  if(alternative.length>markers.length)markers=alternative;
 }
 const first=markers[0]?.index;
 if(!(first>0)||markers.length<2)return null;
 const options=new Set();
 for(let i=0;i<markers.length;i++){
  const marker=markers[i];
  let value=text.slice(marker.index+marker[0].length,markers[i+1]?.index);
  if(i===markers.length-1){
   const tail=value.search(compactAnswer);
   if(tail>=0)value=value.slice(0,tail);
  }
  const folded=relaxed(normalize(value));
  if(folded)options.add(folded);
 }
 return options.size?{text:text.slice(0,first).trim(),options}:null;
}

function parseQuery(query) {
 const input=query.trim().normalize('NFKC');
 // Allow a type label both before and after the number, including stems beginning with GB/JTG.
 const stemWithTail=input.replace(typePrefix,'').replace(numberPrefix,'').replace(typePrefix,'').replace(originalNumber,'');
 const tail=stemWithTail.search(metadata);
 const text=(tail<0?stemWithTail:stemWithTail.slice(0,tail)).trim();
 const choices=pastedOptions(text);
 if(choices)return {...choices,pasted:true,cleaned:true};
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
 if(similar.length)return similar;
 const similarKeywords=rankSimilarKeywords(pool,terms);
 if(similarKeywords.length)return similarKeywords;
 return rankFragments(pool,phrase,parsed.options);
}

function grams(text,size){
 const counts=new Map();
 for(let i=0;i<=text.length-size;i++){
  const gram=text.slice(i,i+size);
  counts.set(gram,(counts.get(gram)||0)+1);
 }
 return counts;
}

function overlap(text,size,queryGrams,onMatch){
 const found=new Map();
 let shared=0;
 for(let i=0;i<=text.length-size;i++){
  const gram=text.slice(i,i+size), max=queryGrams.get(gram);
  if(!max)continue;
  const count=found.get(gram)||0;
  if(count<max){found.set(gram,count+1);shared++;onMatch?.(i,i+size);}
 }
 return shared;
}

const criticalPattern=/[a-z0-9.,:/+%‰*~×÷=<>≤≥±-]+|大于|小于|高于|低于|多于|少于|不少|至少|至多|最大|最小|最高|最低|正确|错误|严禁|禁止|[不未无非]/gu;
// These distinctions cannot be resolved from spelling similarity alone.
const contrasts=[
 [/以上/u,/以下/u],[/以内/u,/以外/u],[/应当|必须/u,/可以/u],[/直接/u,/间接/u],
 [/水溶性氯离子/u,/酸溶性氯离子/u,/游离(?:性)?氯离子/u],[/连续级配/u,/间断级配/u],
 [/抗压强度/u,/抗拉强度/u,/抗折强度/u,/抗剪强度/u],[/施工企业/u,/监理企业/u],
];

function contrastTerms(query){
 return contrasts.map(group=>({group,terms:group.filter(term=>term.test(query))})).filter(({terms})=>terms.length);
}

function contrastConflicts(queryTerms,field){
 return queryTerms.some(({group,terms})=>group.some(term=>term.test(field))&&!terms.some(term=>term.test(field)));
}

function criticalText(text){
 const fixed=new Uint8Array(text.length), terms=[];
 for(const match of text.matchAll(criticalPattern)){
  terms.push(match[0]);
  fixed.fill(1,match.index,match.index+match[0].length);
 }
 return {fixed,terms,signature:terms.join('|')};
}

// Score a whole field or its best substring. Record the alignment only for displayed results.
function editDistance(query,field,queryFixed,fieldFixed,whole,matched){
 const n=field.length;
 const width=n+1;
 const steps=matched?new Uint8Array((query.length+1)*width):null;
 const equal=1, replace=2, skipQuery=3, skipField=4;
 let prev=new Float64Array(width), next=new Float64Array(width);
 if(whole){
  for(let j=1;j<=n;j++)prev[j]=fieldFixed[j-1]?Infinity:prev[j-1]+1;
 }
 for(let i=1;i<=query.length;i++){
  next[0]=queryFixed[i-1]?Infinity:prev[0]+1;
  for(let j=1;j<=n;j++){
   const fixedQuery=queryFixed[i-1], fixedField=fieldFixed[j-1];
   const same=query[i-1]===field[j-1];
   // Technical values and meaning-changing qualifiers cannot be edited.
   const diagonal=same?prev[j-1]:fixedQuery||fixedField?Infinity:prev[j-1]+1;
   const withoutQuery=fixedQuery?Infinity:prev[j]+1;
   const withoutField=fixedField?Infinity:next[j-1]+1;
   const best=next[j]=Math.min(diagonal,withoutQuery,withoutField);
   if(steps)steps[i*width+j]=best===diagonal?(same?equal:replace):best===withoutQuery?skipQuery:skipField;
  }
  [prev,next]=[next,prev];
 }
 let end=n;
 if(!whole){
  end=0;
  for(let j=1;j<=n;j++)if(prev[j]<prev[end])end=j;
 }
 if(steps&&Number.isFinite(prev[end])){
  for(let i=query.length,j=end;i>0&&j>0;){
   const step=steps[i*width+j];
   if(step===equal)matched[j-1]=1;
   if(step!==skipField)i--;
   if(step!==skipQuery)j--;
  }
 }
 return prev[end];
}

function similarQuery(query,minLength=4){
 const length=query.length;
 if(length<minLength||length>480||!han.test(query))return null;
 return {query,budget:Math.max(1,Math.min(8,Math.floor((length+1)/7))),
  bigrams:grams(query,2),trigrams:length>=22?grams(query,3):null,critical:criticalText(query),contrasts:contrastTerms(query)};
}

function similarMatch(field, spec){
 const {query,budget,bigrams,trigrams,critical}=spec, length=query.length, stem=field.folded;
 if(stem.length<length-budget)return null;
 const shared=overlap(stem,2,bigrams), minShared=length-1-2*budget;
 if(shared<minShared&&(!trigrams||shared<(length-2)*.8))return null;
 if(contrastConflicts(spec.contrasts,stem))return null;
 const whole=stem.length<=length+budget;
 const fieldCritical=field.critical??=criticalText(stem);
 const sameCritical=fieldCritical.signature===critical.signature;
 if(whole&&!sameCritical)return null;
 if(shared>=minShared){
  const distance=editDistance(query,stem,critical.fixed,fieldCritical.fixed,whole);
  if(distance<=budget){
   const score=50-3*distance+2*shared/(length-1)+2*Math.min(1,length/stem.length)+(whole?2:0);
   return {field,spec,score,whole,method:'edit'};
  }
 }
 // A rearranged sentence can still have most of the same three-character phrases.
 if(trigrams&&sameCritical&&stem.length<=length*1.25&&stem.length>=length*.8){
  const similarity=overlap(stem,3,trigrams)/(Math.max(length,stem.length)-2);
  if(similarity>=.8)return {field,spec,score:10+similarity,method:'phrases'};
 }
 return null;
}

// Map the folded UTF-16 positions back to whole characters in the bank's original text.
function originalRanges(field, matched){
 const normalized=[], offsets=[];
 let start=0;
 for(const character of field.source){
  const end=start+character.length;
  const chunk=normalize(character);
  normalized.push(chunk);
  const span=[start,end];
  for(let i=0;i<chunk.length;i++)offsets.push(span);
  start=end;
 }
 // Skip highlighting if normalization across character boundaries changed the positions.
 if(normalized.join('')!==field.literal)return [];
 const removed=new Uint8Array(offsets.length);
 relaxed(field.literal,(offset,length)=>removed.fill(1,offset,offset+length));
 const foldedOffsets=offsets.filter((_,i)=>!removed[i]);
 const ranges=[];
 for(let i=0;i<foldedOffsets.length;){
  const span=foldedOffsets[i];
  let hit=true;
  do{hit=Boolean(matched[i])&&hit;i++;}while(foldedOffsets[i]===span);
  if(!hit)continue;
  const last=ranges.at(-1);
  if(last&&/^\s*$/u.test(field.source.slice(last[1],span[0])))last[1]=span[1];
  else ranges.push([...span]);
 }
 return ranges;
}

function similarResult({entry,score,match,exactTerms=[]}){
 const {field:bestField,spec,whole,method}=match;
 const bestPositions=new Uint8Array(bestField.folded.length);
 if(method==='edit')editDistance(spec.query,bestField.folded,spec.critical.fixed,bestField.critical.fixed,whole,bestPositions);
 else overlap(bestField.folded,3,spec.trigrams,(start,end)=>bestPositions.fill(1,start,end));

 const similarHighlights=new Map();
 const fields=exactTerms.length?indexedEntry(entry).stems:[bestField];
 for(const field of fields){
  const positions=field===bestField?bestPositions:new Uint8Array(field.folded.length);
  for(const term of exactTerms){
   let start=field.folded.indexOf(term);
   while(start!==-1){
    positions.fill(1,start,start+term.length);
    start=field.folded.indexOf(term,start+term.length);
   }
  }
  const ranges=originalRanges(field,positions);
  if(ranges.length)similarHighlights.set(field.source,ranges);
 }
 return {entry,score,kind:'similar',similarHighlights};
}

function rankSimilar(pool,query,options){
 const spec=similarQuery(query);
 if(!spec)return [];
 const matches=[];
 for(const entry of pool){
  let best;
  for(const field of indexedEntry(entry).stems){
   const match=similarMatch(field,spec);
   if(!match)continue;
   match.score+=optionMatches(field,options);
   if(!best||match.score>best.score)best=match;
  }
  if(best)matches.push({entry,score:best.score,match:best});
 }
 return matches.sort(byScore).slice(0,12).map(similarResult);
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
  let best;
  for(const field of stems){
   const match=similarMatch(field,specs[missing]);
   if(match&&(!best||match.score>best.score))best=match;
  }
  if(best){
   const exactTerms=terms.filter((_,i)=>i!==missing).map(term=>term.folded);
   matches.push({entry,score:best.score+anchors/terms.length,match:best,exactTerms});
  }
 }
 return matches.sort(byScore).slice(0,12).map(similarResult);
}

const fragmentSize=4;
const hanFragment=/^\p{Script=Han}{4}$/u;
const standardCode=/^(?:gb(?:\/[tz])?|jgj(?:\/t)?|jtg(?:\/t)?|jt\/t)[a-z]?\d+(?:[./-]\d+)*$/u;

function fragmentConditionsAgree(query,field){
 if(query.signature===field.signature)return true;
 // A citation may be left out, but an explicitly supplied citation or measurement must agree.
 if(query.terms.some(term=>standardCode.test(term)))return false;
 return query.signature===field.terms.filter(term=>!standardCode.test(term)).join('|');
}

// A shared book title is context, not evidence that the question is about the same thing.
function fragmentBody(field){
 if(field.fragmentBody)return field.fragmentBody;
 const titles=[...field.literal.matchAll(/《[^》]+》/gu)];
 if(!titles.length)return {text:field.folded,titles:[]};
 const removed=new Uint8Array(field.literal.length), offsets=new Uint16Array(field.literal.length+1);
 relaxed(field.literal,(start,length)=>removed.fill(1,start,start+length));
 for(let i=0;i<removed.length;i++)offsets[i+1]=offsets[i]+1-removed[i];
 const ranges=titles.map(title=>[offsets[title.index],offsets[title.index+title[0].length]]);
 const text=field.folded.split('');
 for(const [start,end] of ranges)text.fill('\0',start,end);
 return field.fragmentBody={text:text.join(''),titles:ranges};
}

function fragmentIndex(text){
 const index=new Map();
 for(let start=0;start<=text.length-fragmentSize;start++){
  const gram=text.slice(start,start+fragmentSize);
  if(!hanFragment.test(gram))continue;
  if(!index.has(gram))index.set(gram,[]);
  index.get(gram).push(start);
 }
 return index;
}

// Find an ordered chain of non-overlapping phrases. Noise between phrases is allowed.
function orderedFragments(query,index,field,frequency,rareLimit){
 const runs=[];
 for(let start=0;start<=field.length-fragmentSize;start++){
  const locations=index.get(field.slice(start,start+fragmentSize));
  if(!locations||locations.length>8)continue;
  for(const queryStart of locations){
   if(start>0&&queryStart>0&&field[start-1]===query[queryStart-1]&&han.test(field[start-1]))continue;
   let size=fragmentSize;
   while(field[start+size]&&field[start+size]===query[queryStart+size]&&han.test(field[start+size]))size++;
   let rare=0;
   for(let i=0;i<=size-fragmentSize;i++){
    const gram=query.slice(queryStart+i,queryStart+i+fragmentSize);
    if(frequency.get(gram)<=rareLimit)rare++;
   }
   runs.push({start,queryStart,size,rare,weight:size+rare*.75});
  }
 }
 // Bound the chain work for unusually repetitive text, keeping the strongest runs.
 if(runs.length>96)runs.sort((a,b)=>b.weight-a.weight).splice(96);
 runs.sort((a,b)=>a.start-b.start||a.queryStart-b.queryStart);
 let best;
 for(let i=0;i<runs.length;i++){
  const run=runs[i];
  run.total=run.weight;
  for(let j=0;j<i;j++){
   const previous=runs[j];
   if(previous.start+previous.size>run.start||previous.queryStart+previous.size>run.queryStart)continue;
   if(previous.total+run.weight>run.total){
    run.total=previous.total+run.weight;
    run.previous=previous;
   }
  }
  if(!best||run.total>best.total)best=run;
 }
 const chain=[];
 for(let run=best;run;run=run.previous)chain.push(run);
 return chain;
}

function rankFragments(pool,phrase,options){
 if(phrase.folded.length<22||phrase.folded.length>480)return [];
 const query=fragmentBody(phrase).text;
 const hanLength=query.match(/\p{Script=Han}/gu)?.length??0;
 if(hanLength<16)return [];
 const index=fragmentIndex(query), critical=criticalText(phrase.folded), queryTerms=contrastTerms(phrase.folded);
 const frequency=new Map(), candidates=[];
 for(const entry of pool){
  const seenInEntry=new Set();
  for(const field of indexedEntry(entry).stems){
   const body=fragmentBody(field);
   const seen=new Set();
   for(let i=0;i<=body.text.length-fragmentSize;i++){
    const gram=body.text.slice(i,i+fragmentSize);
    if(index.has(gram))seen.add(gram);
   }
   for(const gram of seen)seenInEntry.add(gram);
   if(seen.size<6)continue;
   const fieldCritical=field.critical??=criticalText(field.folded);
   if(fragmentConditionsAgree(critical,fieldCritical)&&!contrastConflicts(queryTerms,field.folded))candidates.push({entry,field,body});
  }
  for(const gram of seenInEntry)frequency.set(gram,(frequency.get(gram)||0)+1);
 }
 const rareLimit=Math.max(3,Math.floor(pool.length*.01));
 const minCoverage=Math.max(12,Math.ceil(hanLength*.48));
 const matches=new Map();
 for(const {entry,field,body} of candidates){
  const chain=orderedFragments(query,index,body.text,frequency,rareLimit);
  const covered=chain.reduce((sum,run)=>sum+run.size,0);
  const rare=chain.reduce((sum,run)=>sum+run.rare,0);
  if(covered<minCoverage||rare<2||chain.length<2&&(covered<17||rare<4))continue;
  const score=covered+rare*.75+4*covered/field.folded.length+optionMatches(field,options);
  if(!matches.has(entry)||matches.get(entry).score<score)matches.set(entry,{entry,field,body,score,chain});
 }
 const ranked=[...matches.values()].sort(byScore);
 const minScore=(ranked[0]?.score??0)*.78;
 const technicalTerms=new Set(critical.terms.filter(term=>digit.test(term)));
 return ranked.filter(match=>match.score>=minScore).slice(0,6).map(({entry,field,body,score,chain})=>{
  const positions=new Uint8Array(field.folded.length);
  for(const run of chain)positions.fill(1,run.start,run.start+run.size);
  // Show matching technical identifiers and titles without using them as question evidence.
  for(const term of field.folded.matchAll(criticalPattern)){
   if(technicalTerms.has(term[0]))positions.fill(1,term.index,term.index+term[0].length);
  }
  for(const [start,end] of body.titles){
   if(phrase.folded.includes(field.folded.slice(start,end)))positions.fill(1,start,end);
  }
  return {entry,score,kind:'similar',similarHighlights:new Map([[field.source,originalRanges(field,positions)]])};
 });
}
export function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
export function highlightRanges(text,ranges=[]){
 let html='', offset=0;
 for(const [start,end] of ranges){
  html+=escapeHtml(text.slice(offset,start))+`<mark>${escapeHtml(text.slice(start,end))}</mark>`;
  offset=end;
 }
 return html+escapeHtml(text.slice(offset));
}
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
