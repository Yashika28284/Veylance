let instances=[];
export function destroyCharts(){for(const c of instances)c.destroy();instances=[];}
export function renderChart(state,metric='accuracy') {
 const canvas=document.getElementById('progress-chart');if(!canvas||!globalThis.Chart)return;
 const percent=metric==='accuracy';
 Chart.defaults.font.family='DM Sans, sans-serif';Chart.defaults.color='#707A70';
 instances.push(new Chart(canvas,{type:'line',data:{labels:state.rounds.map(r=>`R${String(r.number).padStart(2,'0')}`),datasets:[{label:percent?'Accuracy':'Loss',data:state.rounds.map(r=>Number.isFinite(r.metrics[metric])?(percent?r.metrics.accuracy*100:r.metrics.loss):null),borderColor:'#245C48',backgroundColor:'rgba(36,92,72,.055)',borderWidth:2.5,fill:true,tension:.3,pointRadius:3.5,pointBackgroundColor:'#FFFEF9',pointBorderWidth:2,pointHoverRadius:6}]},options:{responsive:true,maintainAspectRatio:false,animation:false,interaction:{intersect:false,mode:'index'},plugins:{legend:{display:false},tooltip:{backgroundColor:'#153D32',padding:12,displayColors:false,callbacks:{label:c=>percent?`${c.parsed.y.toFixed(1)}%`:c.parsed.y.toFixed(3)+''}}},scales:{x:{grid:{display:false},border:{display:false},ticks:{padding:12}},y:{min:0,max:percent?100:undefined,grid:{color:'#E9ECE3',drawTicks:false},border:{display:false},ticks:{stepSize:percent?10:.2,padding:12,callback:n=>percent?`${n}%`:n.toFixed(1)}}}}}));
}
