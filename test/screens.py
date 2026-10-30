"""Visual + functional check of the app in iPhone and desktop sizes against the local mock backend."""
import json, sys, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8765/'
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else 'shots')
OUT.mkdir(parents=True, exist_ok=True)
KEY = urllib.request.urlopen(BASE + '__key').read().decode()
CFG = json.dumps({'u': BASE + 'api', 'k': KEY, 't': 'tutordesk-demo'})
errors = []

def hook(page, tag):
    page.on('console', lambda m: errors.append(f'{tag} console.{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: errors.append(f'{tag} pageerror: {e}'))

def shot(page, name, full=True):
    page.wait_for_timeout(350)
    page.screenshot(path=str(OUT / f'{name}.png'), full_page=full)

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---------- iPhone, demo mode ----------
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='he-IL', timezone_id='Asia/Jerusalem')
    page = ctx.new_page(); hook(page, 'demo')
    page.goto(BASE); page.wait_for_selector('.notebook')
    shot(page, 'm-demo-today')
    page.click('a[data-view="students"]'); page.wait_for_selector('#stuList')
    shot(page, 'm-demo-students')
    page.click('a[data-view="money"]'); page.wait_for_selector('#chart svg')
    shot(page, 'm-demo-money')
    page.click('a[data-view="settings"]'); page.wait_for_selector('.card')
    shot(page, 'm-demo-settings')
    ctx.close()

    # ---------- iPhone, live mode against mock backend ----------
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='he-IL', timezone_id='Asia/Jerusalem')
    ctx.add_init_script(f"if(!localStorage.getItem('td.cfg')) localStorage.setItem('td.cfg', JSON.stringify({CFG}));")
    page = ctx.new_page(); hook(page, 'live')
    page.goto(BASE + '#today'); page.wait_for_selector('.notebook')
    page.wait_for_function("document.querySelector('#syncText') && document.querySelector('#syncText').textContent.startsWith('עודכן')")
    assert 'מצב דמו' not in page.inner_text('#banner'), 'should be live'
    n_open = page.locator('[data-act="logDone"]').count()
    page.locator('[data-act="logDone"]').first.click()
    page.wait_for_function(f"document.querySelectorAll('[data-act=\"logDone\"]').length === {n_open - 1}")
    page.wait_for_selector('#toast.on')
    shot(page, 'm-live-after-log', full=False)
    # undo via toast
    page.click('#toast button')
    page.wait_for_function(f"document.querySelectorAll('[data-act=\"logDone\"]').length === {n_open}")
    # cancel with charge
    page.locator('[data-act="cancelMenu"]').first.click()
    page.wait_for_selector('.sheet')
    shot(page, 'm-live-cancel-menu', full=False)
    page.click('.sheet [data-act="choice"][data-i="0"]')
    page.wait_for_function(f"document.querySelectorAll('[data-act=\"logDone\"]').length === {n_open - 1}")

    # student detail + payment
    page.click('a[data-view="students"]'); page.wait_for_selector('#stuList')
    page.fill('.search', 'איתי'); page.wait_for_timeout(150)
    assert page.locator('#stuList .row').count() == 1, 'search filters list'
    page.locator('#stuList .who').first.click(); page.wait_for_selector('.sheet .d-name')
    bal_before = page.inner_text('.sheet .balance-box .amt')
    shot(page, 'm-live-student', full=False)
    page.click('.sheet [data-act="pay"]'); page.wait_for_selector('form[data-form="pay"]')
    shot(page, 'm-live-payment-form', full=False)
    page.fill('form[data-form="pay"] input[name="amount"]', '300')
    page.click('form[data-form="pay"] [data-seg="method"] button[data-v="מזומן"]')
    page.click('form[data-form="pay"] button[type="submit"]')
    page.wait_for_selector('form[data-form="pay"]', state='detached')
    page.wait_for_timeout(300)
    bal_after = page.inner_text('.sheet .balance-box .amt')
    print('balance', bal_before, '->', bal_after)
    assert bal_before != bal_after
    # contact / follow-up
    page.click('.sheet [data-act="contact"]'); page.wait_for_selector('form[data-form="contact"]')
    page.fill('form[data-form="contact"] textarea', 'סיכמנו על שני שיעורים לפני המבחן')
    page.click('form[data-form="contact"] [data-seg="fuQuick"] button[data-v="3"]')
    page.click('form[data-form="contact"] button[type="submit"]')
    page.wait_for_selector('form[data-form="contact"]', state='detached')
    assert 'סיכמנו על שני שיעורים' in page.inner_text('.sheet .notes')
    page.click('.sheet [data-act="closeSheet"]')

    # new lead
    page.click('[data-act="newStudent"]'); page.wait_for_selector('form[data-form="student"]')
    shot(page, 'm-live-new-student', full=False)
    page.fill('form[data-form="student"] input[name="first"]', 'בדיקה')
    page.fill('form[data-form="student"] input[name="last"]', 'חדשה')
    page.fill('form[data-form="student"] input[name="phoneParent"]', '0529998877')
    page.click('form[data-form="student"] [data-seg="days"] button[data-v="1"]')
    page.click('form[data-form="student"] button[type="submit"]')
    page.wait_for_selector('.sheet .d-name:has-text("בדיקה חדשה")')
    assert '052-9998877' in page.inner_text('.sheet .facts')
    page.click('.sheet [data-act="closeSheet"]')

    page.click('a[data-view="money"]'); page.wait_for_selector('#chart svg')
    page.locator('#chart .hit').nth(11).click()
    shot(page, 'm-live-money', full=False)
    ctx.close()

    # ---------- desktop ----------
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, locale='he-IL', timezone_id='Asia/Jerusalem')
    ctx.add_init_script(f"if(!localStorage.getItem('td.cfg')) localStorage.setItem('td.cfg', JSON.stringify({CFG}));")
    page = ctx.new_page(); hook(page, 'desk')
    page.goto(BASE + '#today'); page.wait_for_selector('.notebook')
    page.wait_for_function("document.querySelector('#syncText').textContent.startsWith('עודכן')")
    shot(page, 'd-today', full=False)
    page.click('a[data-view="students"]'); page.wait_for_selector('#stuList')
    page.locator('#stuList .who').nth(2).click(); page.wait_for_selector('.pane .d-name')
    shot(page, 'd-students', full=False)
    page.click('a[data-view="money"]'); page.wait_for_selector('#chart svg')
    page.locator('#chart .hit').nth(9).hover()
    shot(page, 'd-money', full=False)
    ctx.close()

    # ---------- dark, iPhone ----------
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, color_scheme='dark', locale='he-IL')
    page = ctx.new_page(); hook(page, 'dark')
    page.goto(BASE); page.wait_for_selector('.notebook')
    shot(page, 'm-dark-today', full=False)
    page.click('a[data-view="money"]'); page.wait_for_selector('#chart svg')
    shot(page, 'm-dark-money', full=False)
    ctx.close()

    # ---------- setup link flow ----------
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, locale='he-IL')
    page = ctx.new_page(); hook(page, 'setup')
    import base64
    tok = base64.urlsafe_b64encode(CFG.encode()).decode().rstrip('=')
    page.goto(BASE + '#setup=' + tok)
    page.wait_for_function("document.querySelector('#syncText') && document.querySelector('#syncText').textContent.startsWith('עודכן')", timeout=8000)
    assert 'setup' not in page.url, 'setup token removed from address bar'
    cfg = page.evaluate("localStorage.getItem('td.cfg')")
    assert cfg and KEY in cfg
    ctx.close()
    b.close()

real = [e for e in errors if 'fonts.g' not in e and 'ERR_' not in e]
print('console/page errors:', len(real))
for e in real: print('  ', e)
print('other (network) messages:', len(errors) - len(real))
print('SCREENS OK')
