import { deliveryRecords, verifyDelivery, calibrateDelivery } from './delivery.mjs'
import { pathToFileURL } from 'node:url'

export const rulesVersion = 'arena-2'
const kinds=['compatibility','suppliers','room-modes']
const expand=(id,sku,supplier,price,days,fit=null)=>({id,sku,supplier,price,days,fit})
const box=(x,y,w,h)=>({x,y,w,h})
const hits=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b)

function build(kind,index){
  const cohort=index<12?'ordinary':index<24?'paired':'event'
  const variant=cohort==='paired'?(index%2?'b':'a'):null
  const n=cohort==='paired'?12+Math.floor((index-12)/2):index
  const split=n%6===5?'test':n%6===4?'validation':'train'
  const id=`${kind}-${String(index+1).padStart(2,'0')}`
  const task={id,kind,cohort,split,family:`${kind}-${n%6}`,
    ...(variant?{pair:`${kind}-pair-${n-11}`,variant}:{}),maxActions:16}
  const tight=variant==='b', dynamic=cohort==='event'
  if(kind==='compatibility'){
    const width=60+5*(n%5)
    Object.assign(task,{roles:['base','door','top'],space:width+Number(n%3),
      budget:19000+n*70,deadline:6+n%3,
      suppliers:{local:{fee:1000,freeAt:25000}},
      catalog:[
        expand('base-a','base','local',6700+n*50,4,{series:'A',w:width}),
        expand('base-b','base','local',7300+n*35,5,{series:'B',w:width-5}),
        expand('door-a','door','local',2800+n*30,3,{series:'A',w:width}),
        expand('door-b','door','local',3100+n*40,4,{series:'B',w:width-5}),
        expand('door-mismatch','door','local',2100+n*25,4,{series:'B',w:width}),
        expand('top-a','top','local',3800+n*40,4,{series:'A',w:width}),
        expand('top-b','top','local',4300+n*45,5,{series:'B',w:width-5})
      ]})
    if(tight)task.space=width-1
    if(dynamic)task.event={type:'space-measured',space:width-1}
    const group=tight?'b':'a'
    const order=tag=>({type:'order',products:task.roles.map(role=>`${role}-${tag}`)})
    const reference=dynamic?[order('a'),{type:'cancel',order:1},order('b')]:[order(group)]
    return {task,reference,wrong:dynamic?[order('a')]:[{...order(group),products:[`base-${group}`,'door-mismatch',`top-${group}`]}],
      reason:dynamic?'space':'compatibility'}
  }
  if(kind==='suppliers'){
    const p=5200+n*45
    Object.assign(task,{roles:['desk','chair'],budget:2*p+1550,deadline:6+n%4,
      suppliers:{north:{fee:1500,freeAt:tight?2*p+1000:2*p+400},south:{fee:1700,freeAt:20000}},
      catalog:[
        expand('desk-n','desk','north',p,4),expand('chair-n','chair','north',p+450,5),
        expand('desk-s','desk','south',p-150,3),expand('chair-s','chair','south',p-100,4)
      ]})
    if(dynamic)task.event={type:'supplier-delay',supplier:'north',days:task.deadline+4}
    const north={type:'order',products:['desk-n','chair-n']}
    const south={type:'order',products:['desk-s','chair-s']}
    return {task,reference:dynamic?[north,{type:'cancel',order:1},south]:[tight?south:north],
      wrong:dynamic?[north]:tight?[north]:[{type:'order',products:['desk-s','chair-n']}],reason:dynamic?'deadline':'budget'}
  }
  const w=350+(n%5)*10,h=360+(n%4)*10
  const aisleX=165+(n%4)*5
  const lowAisle=box(aisleX,0,80,h), shiftedAisle=box(aisleX-30,0,80,h)
  Object.assign(task,{room:{w,h},modes:['day','night'],aisle:tight?shiftedAisle:lowAisle,
    furniture:{sofa:{day:{w:80,h:90},night:{w:130,h:175}},desk:{day:{w:80,h:105},night:{w:80,h:55}}}})
  if(dynamic)task.event={type:'aisle-relocated',aisle:shiftedAisle}
  const sofa=x=>({type:'place',item:'sofa',x,y:10+n%5})
  const desk={type:'place',item:'desk',x:w-90,y:140+n%6*5}
  const safe=sofa(0), borderline=sofa(aisleX-130)
  task.furniture.sofa.rotatable=true
  return {task,reference:dynamic?[borderline,desk,safe]:[tight?safe:borderline,desk],
    wrong:[sofa(aisleX-(tight||dynamic?130:100)),desk],reason:'aisle.night'}
}
const records=[...kinds.flatMap(kind=>Array.from({length:30},(_,i)=>build(kind,i))),...deliveryRecords()]
const index=new Map(records.map(record=>[record.task.id,record]))
const lookup=id=>{
  const record=index.get(id)
  if(!record)throw Error(`Неизвестный эпизод ${id}`)
  return record
}
export function listArena({kind,split}={}){
  return records.map(({task:t})=>t).filter(t=>(!kind||kind===t.kind)&&(!split||split===t.split))
    .map(({id,kind,split,cohort,family,pair,variant,budget,deadline})=>({id,kind,split,cohort,family,pair,variant,budget,deadline,suite:'rules'}))
}

function verifier(task,log){
  if(task.kind==='delivery')return verifyDelivery(task,log,rulesVersion)
  const state={orders:new Map(),positions:{},event:null,nextOrder:1,submitted:false}
  const violation=(rule,objects,expected,actual)=>({rule,objects,expected,actual})
  const invalid=[]
  const products=new Map((task.catalog??[]).map(p=>[p.id,p]))
  const active=()=>[...state.orders.values()].flat()
  const placeable=Object.keys(task.furniture??{})
  for(const [i,action] of log.entries()){
    const {type}=action??{}
    let accepted=true
    if(state.submitted)accepted=false
    else if(type==='submit')state.submitted=true
    else if(type==='order'&&task.catalog&&Array.isArray(action.products)&&action.products.length>0&&
       action.products.every(id=>products.has(id))&&new Set([...active(),...action.products]).size===active().length+action.products.length){
      state.orders.set(state.nextOrder++,action.products.slice())
    }else if(type==='cancel'&&state.orders.has(action.order)){
      state.orders.delete(action.order)
    }else if(type==='place'&&placeable.includes(action.item)&&Number.isSafeInteger(action.x)&&Number.isSafeInteger(action.y)&&
        (action.rotate===undefined||typeof action.rotate==='boolean')&&(!action.rotate||task.furniture[action.item].rotatable)){
      state.positions[action.item]={x:action.x,y:action.y,rotate:action.rotate===true}
    }else accepted=false
    if(!accepted)invalid.push(violation('action.invalid',[i+1],'допустимое действие',type??null))
    if(accepted&&type!=='submit'&&task.event&&!state.event)state.event={...task.event,action:i+1}
  }
  const violations=[...invalid]
  const check=(ok,rule,objects,expected,actual)=>{if(!ok)violations.push(violation(rule,objects,expected,actual))}
  const metrics={cost:0,finishDay:0,actions:log.length}
  if(task.catalog){
    const selected=active().map(id=>products.get(id))
    for(const role of task.roles){
      const matches=selected.filter(p=>p.sku===role)
      check(matches.length===1,'role.quantity',[role],1,matches.length)
    }
    for(const ids of state.orders.values()){
      const grouped=new Map()
      for(const id of ids){
        const {supplier,price,days}=products.get(id)
        grouped.set(supplier,(grouped.get(supplier)??0)+price)
        metrics.finishDay=Math.max(metrics.finishDay,state.event?.supplier===supplier?state.event.days:days)
      }
      for(const [supplier,subtotal] of grouped){
        const {fee,freeAt}=task.suppliers[supplier]
        metrics.cost+=subtotal+(subtotal<freeAt?fee:0)
      }
    }
    check(metrics.cost<=task.budget,'budget',[],task.budget,metrics.cost)
    check(metrics.finishDay<=task.deadline,'deadline',[],task.deadline,metrics.finishDay)
    if(task.kind==='compatibility'&&selected.length){
      const base=selected.find(p=>p.sku==='base')
      const space=state.event?.space??task.space
      for(const p of selected){
        check(p.fit.w<=space,'space',[p.id],space,p.fit.w)
        if(base&&p!==base)check(p.fit.series===base.fit.series&&p.fit.w===base.fit.w,'compatibility',
          [base.id,p.id],base.fit,p.fit)
      }
    }
  }else{
    for(const item of placeable)check(Boolean(state.positions[item]),'item.missing',[item],true,false)
    for(const mode of task.modes){
      const placed=[]
      for(const [item,p] of Object.entries(state.positions)){
        const dim=task.furniture[item][mode]
        const footprint=box(p.x,p.y,p.rotate?dim.h:dim.w,p.rotate?dim.w:dim.h)
        check(p.x>=0&&p.y>=0&&p.x+footprint.w<=task.room.w&&p.y+footprint.h<=task.room.h,
          `bounds.${mode}`,[item],task.room,footprint)
        check(!hits(footprint,state.event?.aisle??task.aisle),`aisle.${mode}`,[item],state.event?.aisle??task.aisle,footprint)
        for(const [other,r] of placed)check(!hits(footprint,r),`collision.${mode}`,[item,other],'без пересечения',footprint)
        placed.push([item,footprint])
      }
    }
  }
  return {passed:violations.length===0,violations,metrics,rulesVersion,terminated:state.submitted,
    observation:{orders:[...state.orders].map(([order,products])=>({order,products})),positions:state.positions,event:state.event}}
}
export function verify(id,actionLog){
  const {task}=lookup(id)
  if(!Array.isArray(actionLog)||actionLog.length>task.maxActions)throw Error(`Журнал должен содержать до ${task.maxActions} действий`)
  return structuredClone(verifier(task,actionLog))
}
export function createArenaEpisode(id){
  const {task}=lookup(id)
  const log=[]
  let previous=0
  const potential=result=>-new Set(result.violations.map(v=>v.rule)).size
  previous=potential(verify(id,log))
  return {
    get_task:()=>{
      const {event,...visible}=structuredClone(task)
      return {...visible,...(event?{eventType:event.type}:{}),observation:verify(id,log).observation,rulesVersion}
    },
    arena_action:({action})=>{
      if(log.at(-1)?.type==='submit')throw Error('Эпизод завершён')
      if(log.length>=task.maxActions)throw Error('Лимит действий исчерпан')
      log.push(structuredClone(action))
      const result=verify(id,log)
      const score=potential(result), reward=score-previous
      previous=score
      return {...result,reward,truncated:!result.terminated&&log.length===task.maxActions}
    },
    arena_result:()=>verify(id,log)
  }
}
export function checkArena(){
  const counts={}, cohorts={}
  for(const {task,reference,wrong,reason} of records){
    const success=verify(task.id,reference), failure=verify(task.id,wrong)
    if(!success.passed||failure.passed||!failure.violations.some(v=>v.rule===reason))
      throw Error(JSON.stringify({id:task.id,reason,success,failure}))
    if(task.kind==='room-modes'&&failure.violations.some(v=>v.rule.endsWith('.day')))
      throw Error(`Ночная ловушка срабатывает днём: ${task.id}`)
    if(!same(success,verify(task.id,structuredClone(reference))))throw Error('Повтор журнала изменил результат')
    counts[task.kind]=(counts[task.kind]??0)+1
    cohorts[task.cohort]=(cohorts[task.cohort]??0)+1
  }
  const pairs=records.filter(({task})=>task.variant==='a')
  for(const pair of pairs){
    const variant=records.find(({task})=>task.pair===pair.task.pair&&task.variant==='b')
    if(verify(variant.task.id,pair.reference).passed)throw Error(`A проходит в B: ${pair.task.pair}`)
  }
  const delivery=calibrateDelivery(records,rulesVersion)
  if(delivery.routeAwarePassed!==delivery.episodes||delivery.entranceOnlyPassed>=delivery.routeAwarePassed)
    throw Error('Доставка не различает стратегии')
  return {episodes:records.length,counts,cohorts,pairs:pairs.length,referencesPassed:records.length,knownErrorsRejected:records.length,delivery}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(checkArena(),null,2))
