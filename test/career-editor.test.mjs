// Headless suite for tools/career.html (jsdom).
// Covers both sections, CRUD/uniquify, exact recursive condition JSON, visa/job
// referential integrity, non-blocking validation, and exact whole-file PUT bodies.
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '../tools/career.html'), 'utf8');

const visas = {
  _comment: 'fixture visas',
  visas: [
    { id: 'visitor', name: 'Visitor', durationDays: 15, losable: false },
    { id: 'lmia', name: 'LMIA Work Permit', durationDays: 90, losable: true, graceDays: 3, obtainedVia: 'quest' },
    { id: 'temp_worker', name: 'Temporary Worker', durationDays: 365, losable: true, graceDays: 3, obtainedVia: 'quest' },
    { id: 'broken_visa', name: 'Broken Visa', durationDays: null, losable: false, obtainedVia: 'application', applicationDays: 10,
      requirements: { all: [{ var: 'skills.missing_skill', gte: 2 }] } },
  ],
};
const jobs = {
  _comment: 'fixture jobs',
  jobs: [
    { id: 'dishwasher', name: 'Dishwasher', grantsVisa: 'lmia', hours: { startHour: 9, endHour: 17 }, payPerShift: 120, maxSkips: 3,
      needsCost: { energy: 35, hunger: 20 } },
    { id: 'cook', name: 'Line Cook', requirements: { var: 'skills.cooking', gte: 3 }, grantsVisa: 'lmia', hours: { startHour: 15, endHour: 23 }, payPerShift: 190, maxSkips: 2, minCreditScore: 520 },
    { id: 'broken_job', name: 'Broken Job', requirements: { any: [{ var: 'vars.missing_var', eq: 'x' }] }, grantsVisa: 'ghost_visa',
      hours: { startHour: 8, endHour: 8 }, payPerShift: -5, maxSkips: 0 },
  ],
};
const tuning = { visa: { startStatus: 'visitor' } };
const stats = {
  needs: [{ id: 'hunger', name: 'Hunger' }, { id: 'energy', name: 'Energy' }],
  skills: [{ id: 'english', name: 'English' }, { id: 'cooking', name: 'Cooking' }],
};
const simstate = { variables: [{ id: 'visaStatus', name: 'Visa Status', type: 'string', default: 'visitor' }, { id: 'income', name: 'Income', type: 'number', default: 0 }] };
const quests = { quests: [{ id: 'first_words', name: 'First Words' }] };

const puts = {}, rawPuts = {};
const fetchMock = async (url, opts = {}) => {
  const path = String(url).replace('/api/data/', '');
  if (opts.method === 'PUT') {
    rawPuts[path] = opts.body;
    puts[path] = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({}) };
  }
  const body = { 'visas.json': visas, 'jobs.json': jobs, 'tuning.json': tuning, 'stats.json': stats, 'simstate.json': simstate, 'quests.json': quests }[path];
  return { ok: !!body, status: body ? 200 : 404, json: async () => structuredClone(body) };
};

let alertMessage = '';
const dom = new JSDOM(html, {
  url: 'http://localhost:5173/tools/career.html', runScripts: 'dangerously',
  beforeParse(window) {
    window.fetch = fetchMock;
    window.confirm = () => true;
    window.prompt = () => '';
    window.alert = (message) => { alertMessage = message; };
  },
});
const { window } = dom;
const doc = window.document;
await new Promise((resolve) => setTimeout(resolve, 60));

let failures = 0;
function assert(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}
function fire(element, type) { element.dispatchEvent(new window.Event(type, { bubbles: true })); }
function validationText() { return [...doc.querySelectorAll('#validationList li')].map((li) => li.textContent).join('\n'); }

// ================================================================= render + fixed IDs
assert(window.CareerEditor && window.CareerEditor.state, 'plain script exposes window.CareerEditor');
assert(doc.querySelectorAll('.visa-item').length === 4, 'Visas section renders all visas');
assert(doc.querySelectorAll('.job-item').length === 3, 'Jobs section renders all jobs');
assert(doc.querySelector('input[data-path="visa.id"]').value === 'visitor', 'first visa selected by default');
assert(doc.querySelector('input[data-path="visa.id"]').readOnly, 'visa id is fixed/read-only');
assert(doc.querySelector('input[data-path="job.id"]').value === 'dishwasher', 'first job selected by default');
assert(doc.querySelector('input[data-path="job.id"]').readOnly, 'job id is fixed/read-only');
assert(doc.querySelectorAll('.need-cost-row').length === 2 && doc.querySelector('input[data-path="job.needsCost.energy.amount"]').value === '35', 'job needsCost rows render from sparse data');
assert(doc.querySelector('input[data-path="job.minCreditScore"]').value === '', 'sparse minCreditScore renders blank');
assert(doc.querySelector('[data-visa-id="broken_visa"] .badge')?.textContent === 'permanent', 'permanent visa badge renders');

// ================================================================= validation panel
let text = validationText();
assert(text.includes('unknown skill id "skills.missing_skill"'), 'validation flags unknown requirement skill id');
assert(text.includes('unknown variable "missing_var"'), 'validation flags unknown requirement variable id');
assert(text.includes('grantsVisa references unknown visa "ghost_visa"'), 'validation flags unknown grantsVisa id');
assert(text.includes('endHour equals startHour'), 'validation flags equal start/end hours');
assert(text.includes('payPerShift is negative'), 'validation flags negative pay');
assert(doc.getElementById('save').disabled, 'validation warnings do not make clean data dirty');
window.CareerEditor.state.tuning.visa.startStatus = 'missing_start';
assert(window.CareerEditor.collectValidationIssues().some((issue) => issue.includes('startStatus references missing visa "missing_start"')), 'validation flags missing tuning.visa.startStatus visa');
window.CareerEditor.state.tuning.visa.startStatus = 'visitor';

// ================================================================= visa CRUD + uniquify + fields
window.prompt = () => 'Study Permit';
doc.getElementById('newVisa').click();
assert(doc.querySelector('[data-visa-id="study_permit"]'), 'new visa id is slugified from name');
assert(doc.querySelector('input[data-path="visa.id"]').value === 'study_permit', 'new visa is selected');
window.prompt = () => 'Study Permit';
doc.getElementById('newVisa').click();
assert(doc.querySelector('[data-visa-id="study_permit_2"]'), 'duplicate visa id is uniquified');
window.prompt = () => '';
const visaCount = doc.querySelectorAll('.visa-item').length;
doc.getElementById('newVisa').click();
assert(doc.querySelectorAll('.visa-item').length === visaCount, 'blank visa prompt adds nothing');

doc.querySelector('[data-visa-id="study_permit"]').click();
const visaName = doc.querySelector('input[data-path="visa.name"]'); visaName.value = 'Student Visa'; fire(visaName, 'input');
let permanent = doc.querySelector('input[data-path="visa.permanent"]'); permanent.checked = true; fire(permanent, 'change');
assert(doc.querySelector('input[data-path="visa.durationDays"]').disabled, 'permanent checkbox disables durationDays');
permanent = doc.querySelector('input[data-path="visa.permanent"]'); permanent.checked = false; fire(permanent, 'change');
assert(doc.querySelector('input[data-path="visa.durationDays"]').value === '30', 'unchecking permanent restores 30-day duration');
const losable = doc.querySelector('input[data-path="visa.losable"]'); losable.checked = true; fire(losable, 'change');
const grace = doc.querySelector('input[data-path="visa.graceDays"]'); grace.value = '7'; fire(grace, 'input');
const obtained = doc.querySelector('select[data-path="visa.obtainedVia"]'); obtained.value = 'application'; fire(obtained, 'change');
const appDays = doc.querySelector('input[data-path="visa.applicationDays"]'); appDays.value = '20'; fire(appDays, 'input');

// Visa requirements exact nested JSON: funds eq 500 + ANY(skills.english gte 5).
doc.querySelector('[data-owner="visa"][data-action="add-leaf"][data-cond-path="requirements"]').click();
let variable = doc.querySelector('[data-owner="visa"][data-role="var"][data-cond-path="requirements.0"]');
variable.value = 'funds'; fire(variable, 'change');
let operator = doc.querySelector('[data-owner="visa"][data-role="op"][data-cond-path="requirements.0"]');
operator.value = 'eq'; fire(operator, 'change');
let value = doc.querySelector('[data-owner="visa"][data-role="value"][data-cond-path="requirements.0"]'); value.value = '500'; fire(value, 'input');
doc.querySelector('[data-owner="visa"][data-action="add-group"][data-cond-path="requirements"]').click();
doc.querySelector('[data-owner="visa"][data-action="add-leaf"][data-cond-path="requirements.1"]').click();
variable = doc.querySelector('[data-owner="visa"][data-role="var"][data-cond-path="requirements.1.0"]'); variable.value = 'skills.english'; fire(variable, 'change');
value = doc.querySelector('[data-owner="visa"][data-role="value"][data-cond-path="requirements.1.0"]'); value.value = '5'; fire(value, 'input');
const combo = doc.querySelector('[data-owner="visa"][data-role="combinator"][data-cond-path="requirements.1"]'); combo.value = 'any'; fire(combo, 'change');
const studyVisa = window.CareerEditor.state.visas.visas.find((visa) => visa.id === 'study_permit');
const expectedVisaRequirements = { all: [{ var: 'funds', eq: 500 }, { any: [{ var: 'skills.english', gte: 5 }] }] };
assert(JSON.stringify(studyVisa.requirements) === JSON.stringify(expectedVisaRequirements), 'visa condition builder produces exact nested JSON');

// ================================================================= job CRUD + uniquify + fields + exact conditions
window.prompt = () => 'Cashier'; doc.getElementById('newJob').click();
assert(doc.querySelector('[data-job-id="cashier"]'), 'new job id is slugified from name');
window.prompt = () => 'Cashier'; doc.getElementById('newJob').click();
assert(doc.querySelector('[data-job-id="cashier_2"]'), 'duplicate job id is uniquified');
window.prompt = () => ''; const jobCount = doc.querySelectorAll('.job-item').length; doc.getElementById('newJob').click();
assert(doc.querySelectorAll('.job-item').length === jobCount, 'blank job prompt adds nothing');

doc.querySelector('[data-job-id="cashier"]').click();
const cashier = window.CareerEditor.state.jobs.jobs.find((job) => job.id === 'cashier');
const jobName = doc.querySelector('input[data-path="job.name"]'); jobName.value = 'Senior Cashier'; fire(jobName, 'input');
const grants = doc.querySelector('select[data-path="job.grantsVisa"]'); grants.value = 'study_permit'; fire(grants, 'change');
const start = doc.querySelector('input[data-path="job.startHour"]'); start.value = '7'; fire(start, 'input');
const end = doc.querySelector('input[data-path="job.endHour"]'); end.value = '15'; fire(end, 'input');
const pay = doc.querySelector('input[data-path="job.payPerShift"]'); pay.value = '210'; fire(pay, 'input');
const skips = doc.querySelector('input[data-path="job.maxSkips"]'); skips.value = '4'; fire(skips, 'input');
const credit = doc.querySelector('input[data-path="job.minCreditScore"]'); credit.value = '575'; fire(credit, 'input');
doc.getElementById('addNeedsCost').click();
let costAmount = doc.querySelector('input[data-path="job.needsCost.hunger.amount"]'); costAmount.value = '18'; fire(costAmount, 'input');
let costNeed = doc.querySelector('select[data-path="job.needsCost.hunger.need"]'); costNeed.value = 'energy'; fire(costNeed, 'change');
assert(cashier.needsCost.energy === 18 && !('hunger' in cashier.needsCost), 'job needsCost add row and need dropdown stay sparse');

doc.querySelector('[data-owner="job"][data-action="add-leaf"][data-cond-path="requirements"]').click();
variable = doc.querySelector('[data-owner="job"][data-role="var"][data-cond-path="requirements.0"]'); variable.value = 'vars.income'; fire(variable, 'change');
operator = doc.querySelector('[data-owner="job"][data-role="op"][data-cond-path="requirements.0"]'); operator.value = 'gte'; fire(operator, 'change');
value = doc.querySelector('[data-owner="job"][data-role="value"][data-cond-path="requirements.0"]'); value.value = '100'; fire(value, 'input');
assert(JSON.stringify(cashier.requirements) === JSON.stringify({ all: [{ var: 'vars.income', gte: 100 }] }), 'job condition builder produces exact JSON');
assert(cashier.grantsVisa === 'study_permit' && cashier.hours.startHour === 7 && cashier.hours.endHour === 15 && cashier.payPerShift === 210 && cashier.maxSkips === 4 && cashier.minCreditScore === 575, 'job fields update their schema values');

// ================================================================= referential integrity branches
doc.querySelector('[data-visa-id="visitor"]').click();
alertMessage = ''; doc.getElementById('deleteVisa').click();
assert(alertMessage.includes('tuning.visa.startStatus') && doc.querySelector('[data-visa-id="visitor"]'), 'deleting startStatus visa is blocked with a message');

doc.querySelector('[data-visa-id="lmia"]').click();
let confirmMessage = '';
window.confirm = (message) => { confirmMessage = message; return false; };
doc.getElementById('deleteVisa').click();
assert(confirmMessage.includes('Dishwasher') && confirmMessage.includes('Line Cook'), 'referenced visa delete lists every granting job');
assert(doc.querySelector('[data-visa-id="lmia"]'), 'cancelled referenced visa delete changes nothing');
window.confirm = (message) => { confirmMessage = message; return true; };
doc.getElementById('deleteVisa').click();
assert(!doc.querySelector('[data-visa-id="lmia"]'), 'confirmed referenced visa delete removes visa');
assert(!window.CareerEditor.state.jobs.jobs.find((job) => job.id === 'dishwasher').grantsVisa && !window.CareerEditor.state.jobs.jobs.find((job) => job.id === 'cook').grantsVisa, 'referenced visa delete strips grantsVisa from every job');

doc.querySelector('[data-visa-id="temp_worker"]').click();
window.confirm = (message) => { confirmMessage = message; return true; };
doc.getElementById('deleteVisa').click();
assert(confirmMessage.includes('No jobs grant it') && !doc.querySelector('[data-visa-id="temp_worker"]'), 'unreferenced visa uses plain confirm and deletes');

doc.querySelector('[data-job-id="cashier_2"]').click();
window.confirm = (message) => { confirmMessage = message; return false; }; doc.getElementById('deleteJob').click();
assert(confirmMessage.includes('no authored cross-references') && doc.querySelector('[data-job-id="cashier_2"]'), 'job delete is plain confirm and can be cancelled');
window.confirm = () => true; doc.getElementById('deleteJob').click();
assert(!doc.querySelector('[data-job-id="cashier_2"]'), 'confirmed job delete removes job');

// ================================================================= exact whole-file PUTs
doc.getElementById('save').click();
await new Promise((resolve) => setTimeout(resolve, 60));
const expectedVisas = window.CareerEditor.state.visas;
const expectedJobs = window.CareerEditor.state.jobs;
assert(rawPuts['visas.json'] === JSON.stringify(expectedVisas, null, 2), 'visas PUT body is exact JSON.stringify(data, null, 2) payload');
assert(rawPuts['jobs.json'] === JSON.stringify(expectedJobs, null, 2), 'jobs PUT body is exact JSON.stringify(data, null, 2) payload');
assert(!puts['visas.json'].visas.some((visa) => visa.id === 'lmia' || visa.id === 'temp_worker'), 'visas PUT excludes both deleted visas');
assert(!puts['jobs.json'].jobs.find((job) => job.id === 'dishwasher').grantsVisa && !puts['jobs.json'].jobs.find((job) => job.id === 'cook').grantsVisa, 'jobs PUT contains reconciled grantsVisa removals');
const savedStudy = puts['visas.json'].visas.find((visa) => visa.id === 'study_permit');
assert(savedStudy.name === 'Student Visa' && savedStudy.durationDays === 30 && savedStudy.losable === true && savedStudy.graceDays === 7 && savedStudy.obtainedVia === 'application' && savedStudy.applicationDays === 20, 'visas PUT contains all edited visa fields');
assert(JSON.stringify(savedStudy.requirements) === JSON.stringify(expectedVisaRequirements), 'visas PUT preserves exact nested requirements JSON');
const savedCashier = puts['jobs.json'].jobs.find((job) => job.id === 'cashier');
assert(savedCashier.minCreditScore === 575, 'jobs PUT preserves optional minCreditScore');
assert(JSON.stringify(savedCashier.requirements) === JSON.stringify({ all: [{ var: 'vars.income', gte: 100 }] }), 'jobs PUT preserves exact requirements JSON');
assert(JSON.stringify(savedCashier.needsCost) === JSON.stringify({ energy: 18 }), 'jobs PUT preserves sparse needsCost JSON');
assert(doc.getElementById('save').disabled, 'save button disables after both files save');

if (failures) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nALL CAREER-EDITOR TESTS PASSED');
