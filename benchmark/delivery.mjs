const moves={left:[-1,0],right:[1,0],up:[0,-1],down:[0,1]}
const key=({x,y,rotated})=>`${x},${y},${Number(rotated)}`
const atEntrance=()=>({x:0,y:0,rotated:false})
const dimensions=(pack,pose)=>pose.rotated?[pack.depth,pack.length]:[pack.length,pack.depth]
const free=(grid,x,y,w,h)=>{
  for(let row=y;row<y+h;row++){
    for(let col=x;col<x+w;col++)if(grid[row]?.[col]!=='.')return false
  }
  return true
}
const reached=(destination,pack,pose)=>{
  const [w,h]=dimensions(pack,pose)
  return pose.x>=destination.x&&pose.y>=destination.y&&
    pose.x+w<=destination.x+destination.w&&pose.y+h<=destination.y+destination.h
}

function transition(grid,pack,pose,direction){
  if(direction==='turn'){
    if(!free(grid,pose.x,pose.y,pack.length,pack.length))return null
    return {...pose,rotated:!pose.rotated}
  }
  if(!Object.hasOwn(moves,direction))return null
  const [dx,dy]=moves[direction]
  const next={...pose,x:pose.x+dx,y:pose.y+dy}
  return free(grid,next.x,next.y,...dimensions(pack,next))?next:null
}

function findRoute(grid,destination,pack){
  const start=atEntrance(), queue=[{pose:start,route:[]}], seen=new Set([key(start)])
  if(!free(grid,start.x,start.y,...dimensions(pack,start)))return null
  for(let i=0;i<queue.length;i++){
    const {pose,route}=queue[i]
    if(reached(destination,pack,pose))return route
    for(const direction of [...Object.keys(moves),'turn']){
      const next=transition(grid,pack,pose,direction)
      if(!next||seen.has(key(next)))continue
      seen.add(key(next))
      queue.push({pose:next,route:[...route,{type:'carry',direction}]})
    }
  }
  return null
}

function makeGrid(corner,depth,wide){
  return Array.from({length:depth},(_,y)=>Array.from({length:corner+4},(_,x)=>{
    const corridor=y<3&&x<corner+3
    const landing=wide&&y<4&&x>=corner
    const vertical=x>=corner&&x<corner+3
    return corridor||landing||vertical?'.':'#'
  }).join(''))
}

export function deliveryRecords(){
  return Array.from({length:30},(_,i)=>{
    const cohort=i<12?'ordinary':i<24?'paired':'event'
    const variant=cohort==='paired'?(i%2?'b':'a'):null
    const n=variant?12+Math.floor((i-12)/2):i
    const corner=5+n%4, depth=variant&&n>=16?13+n%2:9+Math.floor(n/4)%4
    const wide=variant==='a'||cohort==='event'||(cohort==='ordinary'&&n%2===0)
    const grid=makeGrid(corner,depth,wide)
    const task={
      id:`delivery-${String(i+1).padStart(2,'0')}`,kind:'delivery',cohort,
      family:`delivery-${corner}-${depth}`,split:corner===8?'test':corner===7?'validation':'train',
      ...(variant?{pair:`delivery-pair-${n-11}`,variant}:{}),
      maxActions:32,cellCm:25,grid,destination:{x:corner,y:depth-4,w:3,h:4},
      packages:[{id:'assembled',length:4,depth:2,price:12000+n*50},
        {id:'flatpack',length:3,depth:2,price:13800+n*50}],
      budget:14500+n*50
    }
    if(cohort==='event')task.event={type:'turning-bay-closed',grid:makeGrid(corner,depth,false)}
    const after=task.event?.grid??grid
    const choose=pack=>({type:'package',id:pack.id})
    const cheap=task.packages[0], compact=task.packages[1]
    const chosen=wide&&!task.event?cheap:compact
    const route=findRoute(after,task.destination,chosen)
    if(!route||route.length+3>task.maxActions)throw Error(`Не найден маршрут: ${task.id}`)
    if((!wide||task.event)&&findRoute(after,task.destination,cheap))throw Error(`Крупная упаковка проходит: ${task.id}`)
    const reference=[...(task.event?[choose(cheap)]:[]),choose(chosen),...route,{type:'submit'}]
    const wrong=[choose(chosen),{type:'carry',direction:'up'},{type:'submit'}]
    return {task,reference,wrong,reason:'delivery.blocked'}
  })
}

export function verifyDelivery(task,log,rulesVersion){
  let pack=null, pose=atEntrance(), event=null, terminated=false
  const violations=[]
  const fail=(rule,objects,expected,actual)=>violations.push({rule,objects,expected,actual})
  for(const [i,action] of log.entries()){
    const {type}=action??{}
    if(terminated){
      fail('action.invalid',[i+1],'до завершения эпизода',type??null)
    }else if(type==='submit'){
      terminated=true
    }else if(type==='package'&&key(pose)===key(atEntrance())&&task.packages.some(p=>p.id===action.id)){
      pack=task.packages.find(p=>p.id===action.id)
      if(task.event&&!event)event={...task.event,action:i+1}
    }else if(type==='carry'&&pack){
      const next=transition(event?.grid??task.grid,pack,pose,action.direction)
      if(next)pose=next
      else fail('delivery.blocked',[i+1,pack.id],'свободный шаг или площадка поворота',{pose,direction:action.direction??null})
    }else fail('action.invalid',[i+1],'допустимое действие',type??null)
  }
  if(!pack)fail('delivery.package',[],'выбрать упаковку',null)
  if(pack&&pack.price>task.budget)fail('budget',[pack.id],task.budget,pack.price)
  if(!pack||!reached(task.destination,pack,pose))fail('delivery.destination',[],task.destination,pose)
  return {passed:violations.length===0,violations,metrics:{cost:pack?.price??0,finishDay:0,actions:log.length},
    rulesVersion,terminated,observation:{package:pack?.id??null,pose,event,grid:event?.grid??task.grid}}
}

export function compareDelivery(task,rulesVersion){
  const [cheap,compact]=task.packages
  const choose=pack=>({type:'package',id:pack.id})
  const submit={type:'submit'}
  const baseline=verifyDelivery(task,[choose(cheap),...(findRoute(task.grid,task.destination,cheap)??[]),submit],rulesVersion)
  const log=[choose(cheap)]
  const {observation}=verifyDelivery(task,log,rulesVersion)
  let route=findRoute(observation.grid,task.destination,cheap)
  if(!route){
    log.push(choose(compact))
    route=findRoute(observation.grid,task.destination,compact)
  }
  log.push(...(route??[]),submit)
  return {baseline,constrained:verifyDelivery(task,log,rulesVersion),changedPackage:log[1]?.type==='package'}
}

export function calibrateDelivery(records,rulesVersion){
  const results=records.filter(r=>r.task.kind==='delivery').map(({task})=>compareDelivery(task,rulesVersion))
  return {episodes:results.length,entranceOnlyPassed:results.filter(r=>r.baseline.passed).length,
    routeAwarePassed:results.filter(r=>r.constrained.passed).length,changedPackage:results.filter(r=>r.changedPackage).length}
}
