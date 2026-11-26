import { pathToFileURL } from 'node:url'
import { createInterface } from 'node:readline'

const categories = {
  bed: ['Кровать', 100, 200, 17000, 0],
  desk: ['Рабочий стол', 100, 55, 8500, 0],
  closet: ['Шкаф', 90, 60, 13000, 55],
  sofa: ['Диван', 160, 85, 26000, 0],
  dining: ['Обеденный стол', 100, 65, 11000, 0],
  washer: ['Стиральная машина', 60, 47, 28000, 50, 'water', 9],
  fridge: ['Холодильник', 60, 59, 34000, 55, 'power', 7],
  dishwasher: ['Посудомоечная машина', 45, 55, 32000, 55, 'water', 8],
  dryer: ['Сушильная машина', 60, 57, 36000, 50, 'power', 8]
}
const programs = {
  furnishing: [
    ['bed','desk','closet'], ['bed','bed','desk'], ['sofa','desk','closet'],
    ['sofa','dining','closet'], ['bed','desk','desk']
  ],
  procurement: [
    ['bed','closet','desk'], ['sofa','dining','desk'], ['bed','bed','closet'],
    ['closet','desk','desk'], ['sofa','closet','dining']
  ],
  appliances: [
    ['washer'], ['fridge'], ['dishwasher'], ['dryer'], ['washer','fridge']
  ],
  project: [
    ['bed','desk','closet','washer'], ['sofa','dining','closet','fridge'],
    ['bed','desk','desk','dishwasher'], ['bed','bed','closet','dryer'],
    ['sofa','desk','closet','washer','fridge']
  ]
}
const counts = { furnishing:40, procurement:30, appliances:20, project:10 }
const families = [
  {width:380,depth:460,doorOffset:0,side:'left'},
  {width:410,depth:480,doorOffset:-30,side:'right'},
  {width:440,depth:425,doorOffset:20,side:'left'},
  {width:400,depth:530,doorOffset:40,side:'right'},
  {width:470,depth:410,doorOffset:-45,side:'left'},
  {width:350,depth:510,doorOffset:15,side:'right'},
  {width:420,depth:450,doorOffset:-45,side:'left'},
  {width:460,depth:480,doorOffset:55,side:'right'},
  {width:430,depth:540,doorOffset:50,side:'left'},
  {width:490,depth:430,doorOffset:-50,side:'right'}
]
const variants = [
  {id:'compact', extraWidth:0,extraDepth:0,price:1.12,days:3,quality:2},
  {id:'standard',extraWidth:10,extraDepth:8,price:1,days:6,quality:3},
  {id:'comfort',extraWidth:20,extraDepth:15,price:1.23,days:9,quality:5},
  {id:'economy',extraWidth:0,extraDepth:0,price:.86,days:14,quality:1}
]
const deliveryFee=2300
const round = n => Math.round(n/50)*50
const overlap = (a,b) => a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h
const inside = (r,room) => r.x>=0&&r.y>=0&&r.x+r.w<=room.width&&r.y+r.h<=room.depth
const tally = values => {
  const result = new Map()
  for (const value of values) result.set(value,(result.get(value)??0)+1)
  return result
}

function catalogFor(index,required) {
  return Object.entries(categories).flatMap(([category,spec],c)=>
    variants.map((variant,v)=>{
      const [name,w,h,base,swing,connection=null,serviceDepth=0]=spec
      return {
        sku:`${category}-${variant.id}`,name:`${name} · ${variant.id}`,category,
        w:w+variant.extraWidth,h:h+variant.extraDepth,swing,connection,serviceDepth,
        price:round(base*variant.price*(.94+((index+c)%7)*.025)),
        assembly:connection?1400:650+v*150,days:variant.days+((index+c)%3),
        stock:v===0?Math.max(1,required.filter(item=>item===category).length):((index+c+v)%7===0?0:2),
        quality:variant.quality
      }
    }))
}

function quote(catalog,skuList) {
  let total=skuList.length?deliveryFee:0, days=0
  const lines=[]
  for(const [sku,quantity] of tally(skuList)){
    const product=catalog.find(p=>p.sku===sku)
    if(!product)throw Error(`Неизвестный товар ${sku}`)
    if(quantity>product.stock)throw Error(`Недостаточно товара ${sku}`)
    const subtotal=(product.price+product.assembly)*quantity
    lines.push({sku,quantity,subtotal})
    total+=subtotal
    days=Math.max(days,product.days)
  }
  return {total,days,delivery:skuList.length?deliveryFee:0,lines}
}

function geometry(item,product) {
  if(item.facing==='south')return {
    footprint:{x:item.x,y:item.y,w:product.w,h:product.h+product.serviceDepth},
    front:{x:item.x,y:item.y+product.h+product.serviceDepth,w:product.w,h:Math.max(60,product.swing)}
  }
  return {
    footprint:{x:item.x,y:item.y,w:product.h+product.serviceDepth,h:product.w},
    front:{x:item.x+product.h+product.serviceDepth,y:item.y,w:Math.max(60,product.swing),h:product.w}
  }
}
function assess(task,submission,ordered=[]) {
  const errors=[]
  const layout=task.layouts.find(l=>l.id===submission?.layout)
  if(!layout||!Array.isArray(submission?.items))return {passed:false,score:0,errors:['Укажите допустимую планировку и список предметов']}
  const seen=new Set(), purchased=[], regions=[]
  for(const item of submission.items){
    const requirement=task.requirements.find(r=>r.id===item?.id)
    const product=task.catalog.find(p=>p.sku===item?.sku)
    const room=layout.rooms.find(r=>r.id===requirement?.room)
    if(!requirement||!product||!room||seen.has(item.id)||requirement.category!==product.category||
       (requirement.owned&&product.sku!==requirement.owned)){
      errors.push(`Неподходящий или повторный предмет: ${item?.id??'—'}`);continue
    }
    seen.add(item.id)
    if(!requirement.owned)purchased.push(product.sku)
    if(!Number.isInteger(item.x)||!Number.isInteger(item.y)||!['south','east'].includes(item.facing)){
      errors.push(`Некорректные координаты: ${item.id}`);continue
    }
    const {footprint,front}=geometry(item,product)
    if(!inside(footprint,room)||!inside(front,room))errors.push(`Предмет или зона доступа за границей комнаты: ${item.id}`)
    if(overlap(footprint,room.aisle))errors.push(`Перекрыт проход от двери: ${item.id}`)
    if(product.connection){
      const niche=room.niches.find(n=>n.id===requirement.id)
      if(!niche||niche.connection!==product.connection||
         !inside({...footprint,x:footprint.x-niche.x,y:footprint.y-niche.y},{width:niche.w,depth:niche.h})){
        errors.push(`Предмет с учётом подключения не помещается у вывода: ${item.id}`)
      }
    }
    regions.push({room:room.id,id:item.id,footprint,front,quality:product.quality})
  }
  for(const r of task.requirements)if(!seen.has(r.id))errors.push(`Отсутствует предмет: ${r.id}`)
  for(const [i,a] of regions.entries()){
    for(const b of regions.slice(i+1)){
      if(a.room===b.room&&(overlap(a.footprint,b.footprint)||overlap(a.footprint,b.front)||overlap(a.front,b.footprint))){
        errors.push(`Предметы или зоны открывания пересекаются: ${a.id}, ${b.id}`)
      }
    }
  }
  let cost=null
  try {
    cost=quote(task.catalog,purchased)
    if(cost.total+layout.cost>task.budget)errors.push('Превышен бюджет')
    if(Math.max(cost.days,layout.days)>task.deadline)errors.push('Нарушен срок')
  } catch(error){errors.push(error.message)}
  const demand=tally(purchased), actual=tally(ordered)
  if(demand.size!==actual.size||[...demand].some(([sku,n])=>actual.get(sku)!==n))errors.push('Виртуальные заказы не совпадают со списком покупок')
  const passed=errors.length===0
  const score=passed?80+Math.round(20*regions.reduce((n,r)=>n+r.quality,0)/(regions.length*5)):0
  return {passed,score,errors,total:cost===null?null:cost.total+layout.cost,days:cost===null?null:Math.max(cost.days,layout.days)}
}

function layoutFor(family,index,requirements,id,cost,applianceShift=0,tightNiche=false) {
  const halls=[{id:'main',width:family.width+applianceShift,depth:family.depth}]
  if(requirements.some(r=>r.room==='utility'))halls.push({id:'utility',width:320-applianceShift,depth:310})
  const rooms=halls.map(room=>{
    const doorX=Math.floor((room.width-80)/2)+(room.id==='main'?family.doorOffset:0)
    const niches=requirements.filter(r=>r.room===room.id&&categories[r.category][5]).map((r,i)=>{
      const [,w,h,,,connection,serviceDepth]=categories[r.category]
      const clearance=tightNiche&&i===0?-5:[0,5,10][index%3]
      return {id:r.id,x:family.side==='left'?10:room.width-(w+clearance)-10,y:10+i*135,w:w+clearance,h:h+serviceDepth+clearance,connection}
    })
    return {...room,door:{x:doorX,width:80},aisle:{x:doorX,y:0,w:80,h:room.depth},niches}
  })
  return {id,cost,days:cost?4:0,rooms}
}

function findReference(task) {
  for(const layout of task.layouts){
    const items=[]
    function place(index){
      if(index===task.requirements.length)return true
      const r=task.requirements[index], room=layout.rooms.find(room=>room.id===r.room)
      const products=task.catalog.filter(p=>p.category===r.category&&(r.owned?p.sku===r.owned:p.days<=task.deadline&&p.stock>0))
        .sort((a,b)=>a.price+a.assembly-b.price-b.assembly)
      for(const p of products){
        const buying=items.filter(it=>!task.requirements.find(req=>req.id===it.id).owned).map(it=>it.sku)
        if(!r.owned)buying.push(p.sku)
        try {if(quote(task.catalog,buying).total+layout.cost>task.budget)continue} catch {continue}
        const niche=room.niches.find(n=>n.id===r.id)
        const positions=[]
        if(niche)positions.push({x:niche.x,y:niche.y,facing:'south'})
        else for(const facing of ['south','east']){
          const w=facing==='south'?p.w:p.h
          for(let y=10;y<room.depth;y+=20){
            for(const x of [10,room.width-w-10])positions.push({x,y,facing})
          }
        }
        for(const position of positions){
          const item={id:r.id,sku:p.sku,...position}
          const partial={...task,requirements:task.requirements.slice(0,index+1)}
          if(!assess(partial,{layout:layout.id,items:[...items,item]},buying).passed)continue
          items.push(item)
          if(place(index+1))return true
          items.pop()
        }
      }
      return false
    }
    if(place(0)){
      const order=items.filter((_,i)=>!task.requirements[i].owned).map(item=>item.sku)
      return {layout:layout.id,items,order}
    }
  }
  throw Error(`Нет проверенного решения для ${task.id}`)
}

function buildTask(kind,index) {
  const familyIndex=index%families.length, family=families[familyIndex]
  const needs=programs[kind][(familyIndex+Math.floor(index/10)*2)%programs[kind].length]
  const requirements=[...needs].sort((a,b)=>Number(Boolean(categories[b][5]))-Number(Boolean(categories[a][5]))).map((category,i)=>({
    id:`${category}-${i+1}`,category,room:categories[category][5]?'utility':'main',
    ...(kind==='furnishing'?{owned:`${category}-${i===0&&index%3===0?'standard':'compact'}`}:{})
  }))
  const catalog=catalogFor(index,needs)
  const primary=layoutFor(family,index,requirements,'existing',0,0,kind==='project'&&index%2===0)
  const layouts=kind==='project'?[primary,layoutFor(family,index,requirements,'shift-partition',5500,30)]:[primary]
  const task={
    id:`${kind}-${String(index+1).padStart(2,'0')}`,kind,
    family:`plan-${familyIndex+1}`,split:familyIndex<7?'train':familyIndex<9?'validation':'test',
    requirements,catalog,layouts,budget:kind==='furnishing'?0:Infinity,
    deadline:[6,8,11,16][(index+Math.floor(index/10))%4]
  }
  const initial=findReference(task)
  const cost=assess(task,initial,initial.order).total
  task.budget=cost+(kind==='furnishing'?0:[1800,3300,6700,9800][index%4])
  return {task,reference:findReference(task)}
}

const cases = Object.entries(counts).flatMap(([kind,count])=>Array.from({length:count},(_,i)=>buildTask(kind,i)))
const pilots=cases.slice()

function variations(task,reference){
  const layout=task.layouts.find(l=>l.id===reference.layout)
  if(task.kind==='furnishing'){
    const room=layout.rooms[0]
    return [-60,-40,-20,20,40,60].map(delta=>['door-offset',candidate=>{
      const target=candidate.layouts[0].rooms[0]
      target.door.x=room.door.x+delta
      target.aisle.x=target.door.x
    }])
  }
  if(task.kind==='project'){
    if(reference.layout!=='existing')return []
    const id=layout.rooms.find(r=>r.id==='utility').niches[0].id
    return [['existing-niche-width',candidate=>{
      candidate.layouts[0].rooms.find(r=>r.id==='utility').niches.find(n=>n.id===id).w=40
    }]]
  }
  if(task.kind==='procurement'){
    return [...tally(reference.order)].filter(([,quantity])=>quantity>1).map(([sku,quantity])=>['stock',candidate=>{
      candidate.catalog.find(p=>p.sku===sku).stock=quantity-1
    }])
  }
  return [...new Set(reference.order)].map(sku=>['installation-depth',candidate=>{
    candidate.catalog.find(p=>p.sku===sku).serviceDepth+=15
  }])
}

function diagnosticPairs(){
  const pairs=[]
  for(const kind of Object.keys(counts)){
    let number=0
    for(const original of pilots.filter(({task})=>task.kind===kind)){
      if(number===5)break
      const base=structuredClone(original.task)
      if(kind!=='furnishing')base.budget+=9000
      const reference=findReference(base)
      for(const [factor,change] of variations(base,reference)){
        const variant=structuredClone(base)
        change(variant)
        if(assess(variant,reference,reference.order).passed)continue
        let alternative
        try {alternative=findReference(variant)} catch {continue}
        const pair=`pair-${kind}-${++number}`
        Object.assign(base,{id:pair+'-a',pair,variant:'a',factor,source:original.task.id})
        Object.assign(variant,{id:pair+'-b',pair,variant:'b',factor,source:original.task.id})
        pairs.push([{task:base,reference},{task:variant,reference:alternative}])
        break
      }
    }
    if(number!==5)throw Error(`Не удалось собрать пять диагностических пар: ${kind}, получено ${number}`)
  }
  return pairs
}
const pairs=diagnosticPairs()
cases.push(...pairs.flat())

const cancellationFee=900
function delayedCatalog(catalog,event){
  return catalog.map(p=>p.sku===event.sku?{...p,days:event.days}:p)
}
function adaptationCases(){
  const result=[]
  for(const kind of ['procurement','appliances']){
    for(const original of pilots.filter(({task})=>task.kind===kind)){
      if(result.filter(({task})=>task.kind===kind).length===5)break
      const task=structuredClone(original.task)
      const initial=original.reference
      const target=initial.order.find(sku=>{
        const product=task.catalog.find(p=>p.sku===sku)
        return task.requirements.filter(r=>r.category===product.category).length===1
      })
      if(!target)continue
      const category=task.catalog.find(p=>p.sku===target).category
      const retained=initial.order.filter(sku=>sku!==target)
      const delivery=retained.length?deliveryFee:0
      const event={sku:target,days:task.deadline+5}
      task.budget+=9000
      const restricted=delayedCatalog(task.catalog,event)
        .filter(p=>p.category===category||retained.includes(p.sku))
      try {
        findReference({...task,catalog:restricted,budget:task.budget-cancellationFee-delivery})
      } catch {continue}
      Object.assign(task,{id:`adapt-${kind}-${result.filter(x=>x.task.kind===kind).length+1}`,
        source:original.task.id,disruption:{type:'delivery-delay',category,cancellationFee}})
      result.push({task,initial,target,retained})
    }
  }
  if(result.length!==10)throw Error('Не удалось собрать 10 задач на адаптацию')
  return result
}
const adaptation=adaptationCases()
cases.push(...adaptation)

export function listTasks({kind,split,suite}={}){
  return cases.map(({task})=>task).filter(t=>(!kind||kind===t.kind)&&(!split||split===t.split)&&(!suite||suite===(t.disruption?'adaptation':t.pair?'diagnostic':'pilot')))
    .map(({id,kind,split,family,budget,deadline,pair,variant,factor,source,disruption})=>({id,kind,split,family,budget,deadline,pair,variant,factor,source,disruption}))
}
export function selectTask(id){
  const found=cases.find(({task})=>task.id===id)
  if(!found)throw Error(`Неизвестная задача ${id}`)
  const {task}=found
  const orders=new Map()
  let event=null, cancellationTotal=0
  const catalog=()=>event?delayedCatalog(task.catalog,event):task.catalog
  let nextOrder=1, previousScore=0, steps=0, actions=0
  const inventory=()=>[...orders.values()].flat()
  const available=()=>{
    const held=tally(inventory())
    return catalog().map(p=>({...p,stock:p.stock-(held.get(p.sku)??0)}))
  }
  function cart(skus){
    if(!Array.isArray(skus)||skus.length===0||skus.length>32||skus.some(sku=>typeof sku!=='string'))throw Error('Укажите от 1 до 32 SKU')
    return quote(available(),skus)
  }
  return {
    get_task:()=>structuredClone({ ...task,catalog:undefined,...(task.disruption?{event,cancellationTotal,orders:[...orders].map(([order_id,skus])=>({order_id,skus}))}:{}) }),
    search_products:({category,max_price,max_width,max_depth,deadline,in_stock=true})=>available().filter(p=>
      (!category||p.category===category)&&(max_price==null||p.price<=max_price)&&
      (max_width==null||p.w<=max_width)&&(max_depth==null||p.h+p.serviceDepth<=max_depth)&&
      (deadline==null||p.days<=deadline)&&(!in_stock||p.stock>0)),
    get_product:({sku})=>{
      const product=available().find(p=>p.sku===sku)
      if(!product)throw Error(`Неизвестный товар ${sku}`)
      return product
    },
    quote_cart:({skus})=>cart(skus),
    place_order:({skus})=>{
      actions++
      const result=cart(skus)
      const order_id=String(nextOrder++)
      orders.set(order_id,skus.slice())
      const affected=task.disruption&&!event&&result.lines.find(({sku})=>
        task.catalog.find(p=>p.sku===sku).category===task.disruption.category)
      if(affected){
        event={type:'delivery-delay',order_id,sku:affected.sku,days:task.deadline+5}
        return {order_id,...result,days:Math.max(result.days,event.days),event:{...event}}
      }
      return {order_id,...result}
    },
    cancel_order:({order_id})=>{
      actions++
      if(!orders.delete(order_id))throw Error('Заказ не найден')
      if(task.disruption){
        cancellationTotal+=task.disruption.cancellationFee
        return {order_id,canceled:true,fee:task.disruption.cancellationFee,cancellationTotal}
      }
      return {order_id,canceled:true}
    },
    evaluate:({layout,items})=>{
      actions++
      const result=assess({...task,catalog:catalog()},{layout,items},inventory())
      // Every placed order incurs its own delivery charge.
      const extraDelivery=Math.max(0,orders.size-1)*deliveryFee
      const additionalCosts=extraDelivery+cancellationTotal
      if(result.total!==null&&result.total!==undefined)result.total+=additionalCosts
      if(additionalCosts&&result.total>task.budget&&!result.errors.includes('Превышен бюджет'))result.errors.push('Превышен бюджет с учётом доставки и отмен')
      if(task.disruption&&!event)result.errors.push('Заказ по категории сценария ещё не оформлен')
      if(result.errors.length){result.passed=false;result.score=0}
      const reward=result.score-previousScore
      previousScore=result.score
      return {...result,reward,evaluation:++steps,actions,...(task.disruption?{event:event&&{...event},cancellationTotal}:{})}
    }
  }
}

export function verifyPilot(){
  const countsByKind={}, splitFamilies=new Map()
  let shiftedProjects=0
  for(const {task,reference} of pilots){
    const environment=selectTask(task.id)
    if(reference.order.length){
      if(environment.evaluate(reference).passed)throw Error(`Принято без заказа: ${task.id}`)
      const first=environment.place_order({skus:reference.order})
      environment.cancel_order(first)
      const second=environment.place_order({skus:reference.order})
      if(second.total!==first.total)throw Error(`Отмена не восстановила остатки: ${task.id}`)
    }
    if(reference.layout==='shift-partition')shiftedProjects++
    const passed=environment.evaluate(reference)
    if(!passed.passed)throw Error(`${task.id}: ${passed.errors.join(', ')}`)
    const duplicate=environment.evaluate({...reference,items:[...reference.items,reference.items[0]]})
    if(duplicate.passed)throw Error(`Принят дубль: ${task.id}`)
    const displaced=environment.evaluate({...reference,items:reference.items.map((item,i)=>i===0?{...item,x:-1}:item)})
    if(displaced.passed)throw Error(`Принято размещение за границей: ${task.id}`)
    if(splitFamilies.has(task.family)&&splitFamilies.get(task.family)!==task.split)throw Error('Пересечение семейств')
    splitFamilies.set(task.family,task.split)
    countsByKind[task.kind]=(countsByKind[task.kind]??0)+1
  }
  if(shiftedProjects!==5)throw Error('Ожидалось пять проектов с переносом перегородки')
  return {total:pilots.length,counts:countsByKind,shiftedProjects,splits:Object.fromEntries(tally(pilots.map(({task})=>task.split)))}
}

function runAnswer(task,answer){
  const episode=selectTask(task.id)
  try {
    if(answer.order.length)episode.place_order({skus:answer.order})
  } catch(error) {
    const result=episode.evaluate(answer)
    return {...result,errors:[error.message,...result.errors]}
  }
  return episode.evaluate(answer)
}

function cheapestAnswer(task) {
  const cheapest=new Set()
  for(const category of new Set(task.requirements.map(r=>r.category))){
    const product=task.catalog.filter(p=>p.category===category&&p.stock>0&&p.days<=task.deadline)
      .sort((a,b)=>(a.price+a.assembly)-(b.price+b.assembly))[0]
    if(product)cheapest.add(product.sku)
  }
  const owned=new Set(task.requirements.map(r=>r.owned))
  const restricted={...task,layouts:task.layouts.slice(0,1),catalog:task.catalog.filter(p=>cheapest.has(p.sku)||owned.has(p.sku))}
  try {return findReference(restricted)} catch {return null}
}

export function diagnose(){
  const baselineTotals={a:0,b:0}
  const results=pairs.map(([a,b])=>{
    const first=runAnswer(a.task,a.reference)
    const second=runAnswer(b.task,b.reference)
    const replay=runAnswer(b.task,a.reference)
    if(!first.passed||!second.passed||replay.passed)throw Error(`Невалидная пара: ${a.task.pair}`)
    const baseline=[a,b].map(({task},index)=>{
      const plan=cheapestAnswer(task)
      if(!plan)return {passed:false}
      const result=runAnswer(task,plan)
      if(result.passed)baselineTotals[index===0?'a':'b']++
      return result
    })
    return {pair:a.task.pair,kind:a.task.kind,factor:a.task.factor,split:a.task.split,
      reference:[first,second],replay,baseline}
  })
  return {pairs:results.length,episodes:results.length*2,
    referencePassed:results.length*2,replayPassed:0,baselinePassed:baselineTotals,results}
}

export function calibrateAdaptation(){
  const results=adaptation.map(({task,initial,target,retained})=>{
    const episode=selectTask(task.id)
    const retainedOrder=retained.length?episode.place_order({skus:retained}):null
    const failedOrder=episode.place_order({skus:[target]})
    if(failedOrder.event?.sku!==target||failedOrder.days<=task.deadline)throw Error(`Срыв не сработал: ${task.id}`)
    const baseline=episode.evaluate(initial)
    const cancellation=episode.cancel_order(failedOrder)
    const observed=episode.get_task()
    const kept=observed.orders.flatMap(order=>order.skus)
    const candidates=episode.search_products({category:observed.disruption.category,deadline:observed.deadline})
    const recovery=findReference({...observed,
      budget:observed.budget-observed.cancellationTotal-observed.orders.length*deliveryFee,
      catalog:[...candidates,...[...tally(kept)].map(([sku,stock])=>({...episode.get_product({sku}),stock}))]
    })
    const replacement=recovery.order.find(sku=>candidates.some(p=>p.sku===sku))
    episode.place_order({skus:[replacement]})
    const repaired=episode.evaluate(recovery)
    const retainedIntact=!retainedOrder||episode.get_task().orders.some(order=>order.order_id===retainedOrder.order_id)
    if(baseline.passed||!baseline.errors.includes('Нарушен срок')||!repaired.passed||!retainedIntact||
       repaired.cancellationTotal!==cancellation.fee||repaired.total>task.budget||repaired.days>task.deadline)
      throw Error(`Невалидная калибровка: ${task.id} ${repaired.errors.join(', ')}`)
    return {id:task.id,kind:task.kind,budget:task.budget,deadline:task.deadline,
      event:failedOrder.event,baseline,repaired,retainedOrder:Boolean(retainedOrder)}
  })
  return {episodes:results.length,baselinePassed:results.filter(r=>r.baseline.passed).length,
    repairedPassed:results.filter(r=>r.repaired.passed).length,
    retainedOrders:results.filter(r=>r.retainedOrder).length,results}
}

const string={type:'string'}, integer={type:'integer',minimum:0}
const enumeration=(...values)=>({type:'string',enum:values})
const array=(items,maxItems)=>({type:'array',items,maxItems})
const object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false})
const items=array(object({id:string,sku:string,x:integer,y:integer,facing:enumeration('south','east')},
  ['id','sku','x','y','facing']),32)
const skus=object({skus:{...array(string,32),minItems:1}},['skus'])
const tools=[
  ['list_tasks','Список задач пилота',object({kind:enumeration(...Object.keys(counts)),split:enumeration('train','validation','test'),suite:enumeration('pilot','diagnostic','adaptation')})],
  ['select_task','Начать новый эпизод и сбросить виртуальные заказы',object({id:string},['id'])],
  ['get_task','План, требования, сроки и бюджет текущей задачи',object({})],
  ['search_products','Поиск по каталогу виртуального магазина. Размеры в сантиметрах, цены в рублях',
    object({category:enumeration(...Object.keys(categories)),max_price:integer,max_width:integer,max_depth:integer,deadline:integer,in_stock:{type:'boolean'}})],
  ['get_product','Габариты, подключение, цена, сборка и остаток одного товара',object({sku:string},['sku'])],
  ['quote_cart','Смета виртуальной корзины с доставкой и сборкой',skus],
  ['place_order','Оформить виртуальный заказ и зарезервировать остаток',skus],
  ['cancel_order','Отменить виртуальный заказ и вернуть остаток',object({order_id:string},['order_id'])],
  ['evaluate','Оценить план и текущие виртуальные заказы. Возвращает reward за изменение оценки',
    object({layout:string,items},['layout','items'])]
].map(([name,description,inputSchema])=>({name,description,inputSchema}))

function valid(value,schema){
  if(schema.enum&&!schema.enum.includes(value))return false
  switch(schema.type){
    case 'object':
      return value!==null&&typeof value==='object'&&!Array.isArray(value)&&
        schema.required.every(key=>Object.hasOwn(value,key))&&
        Object.entries(value).every(([key,item])=>Object.hasOwn(schema.properties,key)&&valid(item,schema.properties[key]))
    case 'array':
      return Array.isArray(value)&&value.length>=(schema.minItems??0)&&value.length<=schema.maxItems&&
        value.every(item=>valid(item,schema.items))
    case 'integer':
      return Number.isSafeInteger(value)&&value>=schema.minimum
    default:
      return typeof value===schema.type
  }
}

function runMcp(){
  const input=createInterface({input:process.stdin,crlfDelay:Infinity})
  let environment=null
  const response=(id,result)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,...result})+'\n')
  for(const name of ['SIGINT','SIGTERM'])process.on(name,()=>input.close())
  input.on('line',line=>{
    let message
    try {message=JSON.parse(line)} catch {
      response(null,{error:{code:-32700,message:'Parse error'}})
      return
    }
    if(!message||message.jsonrpc!=='2.0'||typeof message.method!=='string'){
      response(message?.id??null,{error:{code:-32600,message:'Invalid Request'}})
      return
    }
    const {id,method,params}=message
    if(id===undefined)return
    const send=result=>response(id,{result})
    if(method==='initialize'){
      const supported=['2024-11-05','2025-03-26','2025-06-18','2025-11-25']
      const protocolVersion=supported.includes(params?.protocolVersion)?params.protocolVersion:supported.at(-1)
      send({protocolVersion,capabilities:{tools:{}},serverInfo:{name:'plannergym-pilot',version:'0.1.0'}})
    }else if(method==='ping')send({})
    else if(method==='tools/list')send({tools})
    else if(method==='tools/call'){
      const tool=tools.find(t=>t.name===params?.name), args=params?.arguments??{}
      try {
        if(!tool||!valid(args,tool.inputSchema))throw Error('Неизвестный инструмент или неверные аргументы')
        let data
        if(tool.name==='list_tasks')data=listTasks(args)
        else if(tool.name==='select_task'){
          environment=selectTask(args.id)
          data=environment.get_task()
        }else{
          if(!environment)throw Error('Сначала выберите задачу через select_task')
          data=environment[tool.name](args)
        }
        send({content:[{type:'text',text:JSON.stringify(data)}]})
      } catch(error) {
        send({isError:true,content:[{type:'text',text:error.message}]})
      }
    }else response(id,{error:{code:-32601,message:'Method not found'}})
  })
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [command,id]=process.argv.slice(2)
  if(command==='verify')console.log(JSON.stringify(verifyPilot(),null,2))
  else if(command==='calibrate')console.log(JSON.stringify(calibrateAdaptation(),null,2))
  else if(command==='diagnose')console.log(JSON.stringify(diagnose(),null,2))
  else if(command==='list')console.log(JSON.stringify(listTasks(),null,2))
  else if(command==='mcp')runMcp()
  else if(command==='show')console.log(JSON.stringify(selectTask(id).get_task(),null,2))
  else throw Error('Используйте verify, diagnose, calibrate, list, show <id> или mcp')
}
