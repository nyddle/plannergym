import { comparePilot } from './pilot.mjs'
import { compareArena, rulesVersion } from './arena.mjs'

const split=process.argv[2]??'all'
if(!['all','train','validation','test'].includes(split))throw Error('Используйте all, train, validation или test')
const all=[...comparePilot(),...compareArena()]
const rows=all.filter(row=>split==='all'||row.split===split)
const mean=values=>values.length?Math.round(100*values.reduce((a,b)=>a+b,0)/values.length)/100:null
function metrics(results){
  const success=results.filter(r=>r.passed)
  const failures={}
  for(const r of results.filter(r=>!r.passed)){
    for(const rule of new Set((r.violations??[]).map(v=>v.rule).concat(r.errors??[])))failures[rule]=(failures[rule]??0)+1
  }
  return {passed:success.length,attempted:results.length,passRate:mean(results.map(r=>Number(r.passed))),
    meanSuccessfulCost:mean(success.map(r=>r.metrics?.cost??r.total).filter(Number.isFinite)),
    meanSuccessfulActions:mean(success.map(r=>r.metrics?.actions??r.actions).filter(Number.isFinite)),failures}
}
const table=new Map()
for(const row of rows){
  const key=`${row.suite}/${row.kind}`
  if(!table.has(key))table.set(key,[])
  table.get(key).push(row)
}
const aggregate=items=>({baseline:metrics(items.map(r=>r.baseline)),constrained:metrics(items.map(r=>r.constrained))})
console.log(JSON.stringify({rulesVersion,split,episodes:rows.length,total:aggregate(rows),
  bySkill:Object.fromEntries([...table].map(([key,items])=>[key,aggregate(items)]))},null,2))
