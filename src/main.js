import './style.css'
import { supabase } from './supabase'

const $ = (id) => document.getElementById(id)

const authSection = $('auth')
const mainSection = $('main')
const trackerSection = $('tracker')
const notAllowedBox = $('notAllowed')

const email = $('email')
const password = $('password')
const authMsg = $('authMsg')

const btnSignUp = $('btnSignUp')
const btnSignIn = $('btnSignIn')
const btnSignOut = $('btnSignOut')

const dayInput = $('day')
const whoami = $('whoami')

const myCountEl = $('myCount')
const updatedAtEl = $('updatedAt')
const bothCountsEl = $('bothCounts')

const btnPlus = $('btnPlus')
const btnMinus = $('btnMinus')
const setCountInput = $('setCount')
const btnSet = $('btnSet')

const monthRecapCard = $('monthRecapCard')
const monthRecapEl = $('monthRecap')
const yearRecapCard = $('yearRecapCard')
const yearRecapEl = $('yearRecap')

let session = null
let profilesById = new Map()

function todayISO() {
  const d = new Date()
  const tz = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return tz.toISOString().slice(0, 10)
}

function lastDayOfMonthISO(isoDay) {
  const [y, m] = isoDay.split('-').map(Number)
  const d = new Date(Date.UTC(y, m, 0))
  return d.toISOString().slice(0, 10)
}

function monthRange(isoDay) {
  const [y, m] = isoDay.split('-').map(Number)
  const start = new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10)
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  return { start, end }
}

function yearRange(isoDay) {
  const [y] = isoDay.split('-').map(Number)
  return { start: `${y}-01-01`, end: `${y}-12-31` }
}

function fmtName(userId) {
  return profilesById.get(userId)?.display_name || userId.slice(0, 8)
}

async function isAllowedUser() {
  // RLS permite ver solo tu propia fila en allowed_users; si no estás, retorna []
  const { data, error } = await supabase.from('allowed_users').select('user_id').limit(1)
  if (error) throw error
  return (data || []).length > 0
}

async function loadProfiles() {
  const { data, error } = await supabase.from('profiles').select('user_id, display_name')
  if (error) throw error
  profilesById = new Map((data || []).map((p) => [p.user_id, p]))
}

async function ensureMyProfile() {
  const me = session.user.id
  if (profilesById.has(me)) return

  const display_name = prompt('Pon tu nombre (se verá en los recaps):')
  if (!display_name) return

  const { error } = await supabase.from('profiles').insert({ user_id: me, display_name })
  if (error) throw error

  await loadProfiles()
}

async function fetchDayCounts(isoDay) {
  const { data, error } = await supabase
    .from('cry_days')
    .select('user_id, count, updated_at')
    .eq('day', isoDay)

  if (error) throw error
  return data || []
}

function renderBothCounts(rows) {
  if (!rows.length) {
    bothCountsEl.textContent = 'Aún no hay registros para ese día.'
    return
  }
  const sorted = [...rows].sort((a, b) => a.user_id.localeCompare(b.user_id))
  bothCountsEl.innerHTML = sorted
    .map((r) => `<div><strong>${fmtName(r.user_id)}:</strong> ${r.count}</div>`)
    .join('')
}

function renderMine(rows) {
  const me = session.user.id
  const mine = rows.find((r) => r.user_id === me)
  myCountEl.textContent = mine ? String(mine.count) : '0'
  updatedAtEl.textContent = mine?.updated_at ? `Actualizado: ${new Date(mine.updated_at).toLocaleString()}` : ''
}

async function fetchRange(startISO, endISO) {
  const { data, error } = await supabase
    .from('cry_days')
    .select('user_id, day, count')
    .gte('day', startISO)
    .lte('day', endISO)

  if (error) throw error
  return data || []
}

function recapHtml(rows) {
  if (!rows.length) return 'Sin datos todavía.'

  const totals = new Map()
  let grand = 0

  for (const r of rows) {
    totals.set(r.user_id, (totals.get(r.user_id) || 0) + r.count)
    grand += r.count
  }

  const lines = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([uid, total]) => `<div><strong>${fmtName(uid)}:</strong> ${total}</div>`)
    .join('')

  return `${lines}<hr /><div><strong>Total ambos:</strong> ${grand}</div>`
}

async function renderRecaps(isoDay) {
  const { start: ms, end: me } = monthRange(isoDay)
  const monthRows = await fetchRange(ms, me)
  monthRecapEl.innerHTML = recapHtml(monthRows)

  const { start: ys, end: ye } = yearRange(isoDay)
  const yearRows = await fetchRange(ys, ye)
  yearRecapEl.innerHTML = recapHtml(yearRows)

  monthRecapCard.style.display = (isoDay === lastDayOfMonthISO(isoDay)) ? '' : 'none'
  yearRecapCard.style.display = (isoDay.endsWith('-12-31')) ? '' : 'none'
}

async function refreshUI() {
  const isoDay = dayInput.value

  await loadProfiles()
  await ensureMyProfile()

  whoami.innerHTML = `Usuario: <strong>${fmtName(session.user.id)}</strong> — ID: <code>${session.user.id}</code>`

  const rows = await fetchDayCounts(isoDay)
  renderMine(rows)
  renderBothCounts(rows)

  await renderRecaps(isoDay)
}

async function increment(delta) {
  const isoDay = dayInput.value
  const { error } = await supabase.rpc('increment_cry', { p_day: isoDay, p_delta: delta })
  if (error) throw error
  await refreshUI()
}

async function setExactCount(n) {
  const isoDay = dayInput.value
  const { error } = await supabase.rpc('set_cry_count', { p_day: isoDay, p_count: n })
  if (error) throw error
  await refreshUI()
}

// Auth
btnSignUp.addEventListener('click', async () => {
  authMsg.textContent = ''
  const { error } = await supabase.auth.signUp({ email: email.value, password: password.value })
  authMsg.textContent = error
    ? `Error: ${error.message}`
    : 'Cuenta creada. Si tu proyecto requiere confirmación por email, revisa tu correo y confirma.'
})

btnSignIn.addEventListener('click', async () => {
  authMsg.textContent = ''
  const { error } = await supabase.auth.signInWithPassword({ email: email.value, password: password.value })
  authMsg.textContent = error ? `Error: ${error.message}` : ''
})

btnSignOut.addEventListener('click', async () => {
  await supabase.auth.signOut()
})

dayInput.addEventListener('change', async () => {
  if (session) await refreshUI()
})

btnPlus.addEventListener('click', () => increment(1))
btnMinus.addEventListener('click', () => increment(-1))

btnSet.addEventListener('click', async () => {
  const n = Number(setCountInput.value)
  if (!Number.isFinite(n) || n < 0) return alert('Pon un número válido (>= 0).')
  await setExactCount(n)
  setCountInput.value = ''
})

async function showLoggedInUI() {
  authSection.style.display = 'none'
  mainSection.style.display = ''

  dayInput.value = dayInput.value || todayISO()

  // Verificación explícita de allowlist
  const allowed = await isAllowedUser()
  notAllowedBox.style.display = allowed ? 'none' : ''
  trackerSection.style.display = allowed ? '' : 'none'

  if (allowed) await refreshUI()
}

function showLoggedOutUI() {
  mainSection.style.display = 'none'
  authSection.style.display = ''
  trackerSection.style.display = 'none'
  notAllowedBox.style.display = 'none'
  whoami.textContent = ''
}

async function init() {
  dayInput.value = todayISO()

  const { data } = await supabase.auth.getSession()
  session = data.session

  if (session) await showLoggedInUI()
  else showLoggedOutUI()

  supabase.auth.onAuthStateChange(async (_event, newSession) => {
    session = newSession
    if (session) await showLoggedInUI()
    else showLoggedOutUI()
  })
}

init().catch((e) => {
  console.error(e)
  alert(e.message || String(e))
})