import { FEATURES, RESOURCE, PURPOSE, OPERATIONS, REVIEWERS, demoChecksum } from './domain.js';
export const FIXTURE_METRICS = [
  { accuracy:.681, loss:.641, precision:.65, recall:.61, f1:.629, rocAuc:.712 },
  { accuracy:.714, loss:.584, precision:.68, recall:.65, f1:.665, rocAuc:.754 },
  { accuracy:.746, loss:.529, precision:.72, recall:.69, f1:.705, rocAuc:.789 },
  { accuracy:.772, loss:.481, precision:.75, recall:.72, f1:.735, rocAuc:.814 },
  { accuracy:.791, loss:.438, precision:.77, recall:.74, f1:.755, rocAuc:.836 },
  { accuracy:.803, loss:.411, precision:.79, recall:.75, f1:.769, rocAuc:.848 },
  { accuracy:.817, loss:.389, precision:.80, recall:.77, f1:.785, rocAuc:.861 },
  { accuracy:.826, loss:.371, precision:.81, recall:.78, f1:.795, rocAuc:.873 },
  { accuracy:.831, loss:.359, precision:.82, recall:.79, f1:.805, rocAuc:.881 },
  { accuracy:.837, loss:.348, precision:.83, recall:.80, f1:.815, rocAuc:.889 },
  { accuracy:.841, loss:.341, precision:.83, recall:.81, f1:.820, rocAuc:.894 },
  { accuracy:.846, loss:.332, precision:.84, recall:.81, f1:.825, rocAuc:.901 }
];
export function createFixtures() {
  const hospitals = [
    { id:'A', name:'Hospital A', subtitle:'Northfield Research Hospital', records:1840, baseline:.731 },
    { id:'B', name:'Hospital B', subtitle:'Westbridge Medical Centre', records:1260, baseline:.708 },
    { id:'C', name:'Hospital C', subtitle:'Oakridge University Hospital', records:1620, baseline:.746 }
 ];
 const warrants = hospitals.map((h,i) => ({
   id:`WRT-2026-00${i+1}`, hospitalId:h.id, requesterId:`requester-${h.id}`, requesterName:`Hospital ${h.id} researcher`,
   resource:RESOURCE, purpose:PURPOSE, operations:[...OPERATIONS], features:[...FEATURES],
   status:'approved', createdAt:'2026-10-31T08:00:00.000Z', expiresAt:'2026-11-01T09:00:00.000Z', quota:12, used:4,
   controls:['No patient identifiers', 'Aggregate model updates only', 'Four-feature allowlist'],
   reviews:REVIEWERS.map(r=>({...r, at:'2026-10-31T08:15:00.000Z', decision:'approved'})),
   history:[{at:'2026-10-31T08:00:00.000Z',actor:`Hospital ${h.id} researcher`,action:'Warrant requested'},{at:'2026-10-31T08:15:00.000Z',actor:'Three distinct reviewers',action:'Original scope approved'}],
   narrowed:false, consentAt:null
 }));
 const rounds = FIXTURE_METRICS.slice(0,4).map((metrics,i)=>({number:i+1, at:`2026-10-31T08:${25+i*5}:00.000Z`, modelVersion:`v0.${i+1}`, modelHash:demoChecksum({round:i+1,metrics}), metrics, accepted:['A','B','C'],rejected:[],aggregation:'Sample-weighted FedAvg (illustrative)',evaluation:'Pooled synthetic holdout fixture; no training executed'}));
 const state = {schema:1, provenance:{kind:'fixture',label:'Illustrative fixture'}, clock:'2026-10-31T09:00:00.000Z', hospitals, warrants, rounds, events:[], audit:[], scenario:0, nextId:4};
 for (const w of warrants) addAudit(state,{actor:'Governance service · demo',action:'Warrant approved',hospitalId:w.hospitalId,warrantId:w.id,detail:'Three distinct reviewer slots approved the original scope.'});
 addAudit(state,{actor:'Coordinator · demo',action:'Round 4 aggregated',hospitalId:null,warrantId:null,detail:'Three illustrative contributions accepted. Model fixture v0.4.'});
 return state;
}
export function addAudit(s, fields) {
 const payload={id:`AUD-${String(s.audit.length+1).padStart(4,'0')}`,at:s.clock,...fields,previousHash:s.audit.at(-1)?.hash??'demo-genesis'};
 s.audit.push({...payload,hash:demoChecksum(payload)});
}
