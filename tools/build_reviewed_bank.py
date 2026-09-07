"""Build the deployed question bank from explicit boundaries in the reviewed DOCX."""
import argparse, hashlib, json, re
from datetime import datetime
from pathlib import Path
from docx import Document
from pypinyin import lazy_pinyin, Style
ROOT=Path(__file__).resolve().parents[1]
TYPES={'单选题':'单选','多选题':'多选','判断题':'判断','案例题':'案例','综合题':'综合','知识卡':'知识卡','编号知识材料':'知识卡','案例资料':'案例资料'}
LIST_START=re.compile(r'^(?:[①-⑳]|[（(]?[0-9一二三四五六七八九十]+(?:[）、)]|[.．](?!\d))|[A-H][.．、]|第[一二三四五六七八九十0-9]+[章节条款])')
SENTENCE_END=re.compile(r'[。！？；;：:）)】”’」』]$')
EDITORIAL_MARKERS=('【题内说明】','【校订说明】','【答案来源】','【待核】','【关联背景】')
def join_fragments(left,right):
 left=left.rstrip();right=right.lstrip()
 if not left:return right
 if not right:return left
 left=re.sub(r'([”’」』])0$',r'\1。',left)
 boundary_ascii=(left[-1].isascii() and left[-1].isalnum()) or (right[0].isascii() and right[0].isalnum())
 return left+(' ' if boundary_ascii else '')+right
def clean_inline(text):
 parts=[part.strip() for part in re.split(r'[\r\n\v\f]+',text) if part.strip()]
 result=''
 for part in parts:result=join_fragments(result,part)
 return result
def looks_like_heading(text):
 return len(text)<=32 and not re.search(r'[，,、。！？；;：:]',text) and not LIST_START.match(text)
def should_join_material(left,right):
 if SENTENCE_END.search(left) or looks_like_heading(left):return False
 if LIST_START.match(right) or re.match(r'^(?:背景资料|案例(?:讨论|分析)?)[：:]',right):return False
 if re.match(r'^\d{4}\s*年',right):return False
 return len(left)>=20 or bool(LIST_START.match(left))
def merge_material_paragraphs(paragraphs):
 merged=[]
 for paragraph in map(clean_inline,paragraphs):
  if not paragraph:continue
  if merged and should_join_material(merged[-1],paragraph):merged[-1]=join_fragments(merged[-1],paragraph)
  else:merged.append(paragraph)
 return merged
def normalize(s):
 import unicodedata
 return re.sub(r'\s+','',unicodedata.normalize('NFKC',s)).lower()
def build(source):
 entries=[];parent=None;question=None;material=None;section=''
 def flush():
  nonlocal material
  material=None
 for p in Document(source).paragraphs:
  t=p.text.strip()
  m=re.match(r'【大题开始 (DT\d+)】\s*【原题号】(.*?)\s*【类型】(.+)',t)
  if m:
   assert parent is None,'Nested parent'
   parent={'id':m[1],'sourceNo':m[2].strip(),'type':TYPES.get(m[3],m[3]),'section':section,'blocks':[]};question=None;flush();continue
  if t.startswith('【大题结束 '):
   assert parent and t=='【大题结束 '+parent['id']+'】'
   assert question is None or question['id']==parent['id']+'-Q','Unclosed child'
   entries.append(parent);parent=None;question=None;flush();continue
  if parent is None:
   if p.style.name.startswith('Heading'):section=t
   continue
  m=re.match(r'【小题开始 ([^】]+)】.*【类型】(.+)',t)
  if m:
   assert question is None,'Nested child'
   question={'kind':'question','id':m[1],'type':TYPES.get(m[2],m[2]),'stem':'','options':[],'answer':'','notes':[]};parent['blocks'].append(question);flush();continue
  if t.startswith('【小题结束'):
   assert question and t=='【小题结束 '+question['id']+'】','Mismatched child boundary'
   question=None;flush();continue
  if t.startswith(('【来源】','【确认】')):continue
  if t.startswith('【题干】'):
   if question is None:
    question={'kind':'question','id':parent['id']+'-Q','type':parent['type'],'stem':'','options':[],'answer':'','notes':[]};parent['blocks'].append(question);flush()
   question['stem']=t.removeprefix('【题干】');continue
  if question:
   m=re.match(r'^([A-H])[.．]\s*(.*)',t)
   if m:question['options'].append({'key':m[1],'text':m[2]})
   elif t.startswith('【答案】'):question['answer']=t.removeprefix('【答案】')
   elif t.startswith('【'):question['notes'].append(t)
   elif t:question['stem']+='\n'+t
   continue
  if t.startswith(EDITORIAL_MARKERS):flush();continue
  if t.startswith(('【附注】','【说明】')):flush()
  if not t:continue
  if material is None:material={'kind':'material','paragraphs':[]};parent['blocks'].append(material)
  material['paragraphs'].append(re.sub(r'^【(?:背景|内容)】','',t))
 assert parent is None,'Unclosed parent'
 assert len({e['id'] for e in entries})==len(entries)
 for e in entries:
  if e['type'] in ('案例','综合'):
   e['blocks']=[b for b in e['blocks'] if b['kind']=='material']+[b for b in e['blocks'] if b['kind']=='question']
  texts=[]
  for b in e['blocks']:
   if b['kind']=='question':
    b['stem']=clean_inline(b['stem']);b['answer']=clean_inline(b['answer']);b['notes']=[clean_inline(n) for n in b['notes']]
    for option in b['options']:option['text']=clean_inline(option['text'])
    texts += [b['stem']]+[o['text'] for o in b['options']]+[b['answer']]+b['notes']
   else:
    b['paragraphs']=merge_material_paragraphs(b['paragraphs']);texts += b['paragraphs']
  e['title']=next((t for t in texts if t),'')[:100]
  raw='\n'.join(texts);e['search']={'text':normalize(raw),'pinyin':normalize(''.join(lazy_pinyin(raw,style=Style.NORMAL))),'initials':normalize(''.join(lazy_pinyin(raw,style=Style.FIRST_LETTER)))}
 return {'schemaVersion':4,'generatedDate':datetime.now().astimezone().date().isoformat(),'source':source.name,'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'entries':entries}
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--source',type=Path,default=ROOT/'交安复习题全部.大题层级修正版-20260907.docx');args=parser.parse_args()
 data=build(args.source);out=ROOT/'docs/question-bank.json';out.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf-8');print(f"Exported {len(data['entries'])} complete entries to {out}")
