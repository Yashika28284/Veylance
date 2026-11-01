import test from 'node:test';
import assert from 'node:assert/strict';
import {shell,warrantDetail,requestForm} from '../dist/js/pages.js';

test('warrant actions follow the signed-in role and requester identity',()=>{
 const warrant={id:'WRT-test',hospitalId:'A',requesterId:'requester-A',requesterName:'Requester A',resource:'federated-model:hospital-readmission',purpose:'hospital-readmission-research',operations:['train_local','submit_update','download_model'],features:['emergency_admission','prior_inpatient_visits','length_of_stay','medication_count'],expiresAt:'2040-01-01T00:00:00Z',scopeVersion:1,used:0,quota:12,reviews:[],controls:[],history:[],status:'pending'};
 const base={warrants:[warrant],hospitals:[],events:[],rounds:[],audit:[],clock:'2026-11-01T00:00:00Z'};
 for(const [role,sub] of [['requester','requester-A'],['manager','manager-X'],['risk','risk-X'],['owner','owner-X']]){
  const state={...base,user:{name:role,sub,roles:[role],hospital:role==='requester'?'A':null}};
  const heading=shell(state,{page:'warrants',actorId:sub},'','live');
  const detail=warrantDetail(state,warrant.id,sub);
  assert.equal(heading.includes('data-action="request"'),role==='requester');
  for(const action of ['approve','narrow','reject'])assert.equal(detail.includes(`data-action="${action}"`),role!=='requester',`${role}: ${action}`);
  assert.equal(detail.includes('age_band'),false);
 }
 assert.equal(requestForm(base).includes('age_band'),false);
});

test('live warrant form offers only assigned hospitals',()=>{
 const one=requestForm({user:{hospital:'A',hospitals:['A']}});
 assert.match(one,/<option value="A"/);
 assert.doesNotMatch(one,/<option value="B"/);
 const all=requestForm({user:{hospital:'A',hospitals:['A','B','C']}});
 for(const hospital of ['A','B','C'])assert.match(all,new RegExp(`<option value="${hospital}"`));
});
