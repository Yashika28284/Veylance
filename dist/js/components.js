import { effectiveStatus } from './domain.js';
export const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const fmtDate=value=>!value||!Number.isFinite(Date.parse(value))?'—':new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'UTC'}).format(new Date(value))+' UTC';
export const pct=n=>Number.isFinite(n)?`${(n*100).toFixed(1)}%`:'—';
export const number=(n,digits=3)=>Number.isFinite(n)?n.toFixed(digits):'—';
const paths={grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',document:'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h5',network:'M12 8v5 M5 17v-4h14v4 M9 3h6v5H9z M2 17h6v4H2z M16 17h6v4h-6z',shield:'M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7z M8 12l3 3 5-6',history:'M3 11a9 9 0 1 1 2 7 M3 4v7h7 M12 7v5l4 2',arrow:'M5 12h14 M13 6l6 6-6 6',chevron:'M9 5l7 7-7 7',plus:'M12 5v14 M5 12h14',search:'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',check:'M5 12l4 4L19 6',close:'M6 6l12 12 M18 6 6 18',refresh:'M20 8a8 8 0 1 0 0 8 M20 2v6h-6',info:'M12 11v6 M12 7h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',external:'M14 3h7v7 M21 3l-9 9 M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5',menu:'M3 6h18 M3 12h18 M3 18h18',lock:'M6 11h12v10H6z M8 11V7a4 4 0 0 1 8 0v4',download:'M12 3v12 M7 10l5 5 5-5 M4 17v4h16v-4',clock:'M12 7v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0'};
export const icon=(name,size=18)=>`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${(paths[name]||paths.document).split(' M').map((p,i)=>`<path d="${i?'M':''}${p}"/>`).join('')}</svg>`;
export const wordmark=()=>`<a class="wordmark" href="#/" aria-label="Veylance home"><svg viewBox="0 0 32 34" width="29" height="31" aria-hidden="true"><path d="M2 5h7l8 22 6-16h7L18 33h-4z" fill="currentColor"/><path d="M18 3h12l-3 5H16z" fill="currentColor" opacity=".55"/></svg><span>veylance<span class="wordmark-dot">.</span></span></a>`;
export const badge=(status,label)=>`<span class="badge ${esc(status)}"><span class="status-dot"></span>${esc(label??status.replaceAll('_',' '))}</span>`;
export const featureChips=features=>features.map(f=>`<code class="chip">${esc(f)}</code>`).join('');
export const hospitalMark=id=>`<span class="hospital-mark">${esc(id)}</span>`;
export const empty=(title,body)=>`<div class="empty-state">${icon('search',28)}<h3>${esc(title)}</h3><p>${esc(body)}</p></div>`;
export const statusOf=(w,s)=>w?effectiveStatus(w,s.clock):'unavailable';
export const isDemo=()=>globalThis.VEYLANCE_CONFIG?.mode==='demo';
export const modeCopy=(demo,live)=>isDemo()?demo:live;
export const fixtureNote=()=>isDemo()?`<span class="fixture-label">Illustrative fixtures</span>`:'';
export const paginationLabel=n=>`<span class="table-count">${n} ${n===1?'record':'records'} · all shown</span>`;
export function field(name,label,content,hint=''){return `<div class="form-field"><label for="${name}">${label}</label>${content}${hint?`<span class="field-hint">${hint}</span>`:''}</div>`;}
