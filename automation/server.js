const express = require('express');
const { chromium } = require('playwright');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3007;

// Store browser instance for reuse
let browser = null;

async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return browser;
}

// Generate username from name (lowercase, no spaces, add year)
function generateUsername(name) {
  const year = new Date().getFullYear();
  const clean = name.toLowerCase().replace(/[^a-z]/g, '');
  return `${clean}${year}`;
}

// Generate random password
function generatePassword(length = 10) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

// ---- IPTV Panel API Session ----
const https = require('https');
const PANEL_URL = process.env.IPTV_PANEL_URL || 'https://bqque-xizq3ykhpv.mobazzz.com';
const PANEL_USER = process.env.IPTV_PANEL_USER || 'arterburn';
const PANEL_PASS = process.env.IPTV_PANEL_PASS || 'Sb0l7rjjlbn6wAn';

let panelCookies = null;
let panelCsrf = null;
let panelSessionTime = 0;

async function panelLogin() {
  const now = Date.now();
  // Reuse session if < 10 minutes old
  if (panelCookies && panelCsrf && (now - panelSessionTime) < 600000) {
    return { cookies: panelCookies, csrf: panelCsrf };
  }

  // Step 1: GET login page
  const loginPage = await fetch(PANEL_URL, {
    redirect: 'manual',
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  const loginHtml = await loginPage.text();
  const setCookies = loginPage.headers.getSetCookie ? loginPage.headers.getSetCookie() : [];
  
  // Extract cookies
  const cookieJar = {};
  for (const sc of setCookies) {
    const [nameVal] = sc.split(';');
    const [name, ...valParts] = nameVal.split('=');
    cookieJar[name.trim()] = valParts.join('=');
  }

  // Extract CSRF token
  const csrfMatch = loginHtml.match(/name="_token"\s+value="([^"]+)"/);
  if (!csrfMatch) throw new Error('Could not find CSRF token');
  const csrf = csrfMatch[1];

  // Step 2: POST login
  const cookieHeader = Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');
  const loginRes = await fetch(PANEL_URL, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookieHeader,
      'Referer': PANEL_URL,
      'User-Agent': 'Mozilla/5.0',
    },
    body: `_token=${csrf}&username=${PANEL_USER}&password=${PANEL_PASS}`,
  });

  // Collect session cookies from redirect
  const postCookies = loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : [];
  for (const sc of postCookies) {
    const [nameVal] = sc.split(';');
    const [name, ...valParts] = nameVal.split('=');
    cookieJar[name.trim()] = valParts.join('=');
  }

  panelCookies = Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');
  panelSessionTime = now;

  // Step 3: GET lines page to extract CSRF (needed for lines/data requests)
  const linesRes = await fetch(`${PANEL_URL}/lines`, {
    headers: { 'Cookie': panelCookies, 'User-Agent': 'Mozilla/5.0' },
  });
  const linesHtml = await linesRes.text();
  const linesCsrf = linesHtml.match(/csrf-token.*?content="([^"]+)"/);
  panelCsrf = linesCsrf ? linesCsrf[1] : csrf;

  // Update cookies from lines page
  const linesSetCookies = linesRes.headers.getSetCookie ? linesRes.headers.getSetCookie() : [];
  for (const sc of linesSetCookies) {
    const [nameVal] = sc.split(';');
    const [name, ...valParts] = nameVal.split('=');
    cookieJar[name.trim()] = valParts.join('=');
  }
  panelCookies = Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');

  console.log('[PANEL] Logged in successfully');
  return { cookies: panelCookies, csrf: panelCsrf };
}

async function panelLookup(username) {
  const { cookies, csrf } = await panelLogin();

  const res = await fetch(`${PANEL_URL}/lines/data`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookies,
      'X-CSRF-TOKEN': csrf,
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': 'Mozilla/5.0',
    },
    body: [
      'draw=1&start=0&length=10',
      'id=users&filter=&reseller=',
      `search[value]=${encodeURIComponent(username)}`,
      'order[0][column]=0&order[0][dir]=desc',
      'columns[0][data]=id&columns[0][name]=id',
      'columns[1][data]=expired&columns[1][name]=username',
      'columns[2][data]=password&columns[2][name]=password',
      'columns[3][data]=exp_date_show&columns[3][name]=users.exp_date',
      'columns[4][data]=admin_notes_show&columns[4][name]=reseller_notes',
    ].join('&'),
  });

  const data = await res.json();
  const lines = data.data || [];

  // Find exact username match
  const match = lines.find(l => l.username.toLowerCase() === username.toLowerCase());
  if (!match) return null;

  return {
    id: match.id,
    username: match.username,
    password: match.password,
    expireDate: match.exp_date,
    expireTimestamp: match.expire_date,
    enabled: match.enabled === 1,
    connections: `${match.active_connections}/${match.user_connection}`,
    notes: match.reseller_notes,
    owner: match.owner,
  };
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Lookup IPTV user by username
app.get('/api/lookup/:username', async (req, res) => {
  try {
    const result = await panelLookup(req.params.username);
    if (!result) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result);
  } catch (err) {
    console.error('[LOOKUP] Error:', err.message);
    // Reset session on auth errors
    panelCookies = null;
    panelCsrf = null;
    res.status(500).json({ error: err.message });
  }
});

// Bulk lookup for admin panel sync
app.post('/api/lookup-bulk', async (req, res) => {
  try {
    const { usernames } = req.body;
    if (!usernames || !Array.isArray(usernames)) {
      return res.status(400).json({ error: 'Provide usernames array' });
    }

    const results = {};
    for (const username of usernames) {
      try {
        results[username] = await panelLookup(username);
      } catch (err) {
        results[username] = { error: err.message };
      }
    }
    res.json(results);
  } catch (err) {
    console.error('[BULK-LOOKUP] Error:', err.message);
    panelCookies = null;
    res.status(500).json({ error: err.message });
  }
});

// Create new IPTV account
app.post('/api/create', async (req, res) => {
  const { customerName, customerEmail, panelUrl, panelUser, panelPass, planMonths = 1 } = req.body;

  if (!customerName || !panelUrl || !panelUser || !panelPass) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  const username = generateUsername(customerName);
  const password = generatePassword();

  console.log(`[CREATE] Creating account for: ${customerName} → ${username}`);
  
  let context = null;
  let page = null;
  
  try {
    const browser = await getBrowser();
    context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1280, height: 720 },
    });
    page = await context.newPage();

    // Navigate to panel login
    console.log('[CREATE] Navigating to panel...');
    await page.goto(panelUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // Login
    console.log('[CREATE] Logging in...');
    await page.fill('input[name="username"], input[type="text"]', panelUser);
    await page.fill('input[name="password"], input[type="password"]', panelPass);
    await page.click('button[type="submit"], input[type="submit"], .login-btn, #login-btn');
    
    // Wait for dashboard
    await page.waitForTimeout(3000);
    
    // Navigate to create user section
    console.log('[CREATE] Finding create user option...');
    const createLinks = [
      'a:has-text("Add User")',
      'a:has-text("Add Line")',
      'a:has-text("Create User")',
      'a:has-text("New User")',
      'a:has-text("New Line")',
      '[href*="add"]',
      '[href*="create"]',
      'button:has-text("Add")',
    ];
    
    for (const selector of createLinks) {
      try {
        const link = await page.$(selector);
        if (link) {
          await link.click();
          await page.waitForTimeout(2000);
          break;
        }
      } catch (e) {}
    }

    // Fill in the username
    console.log(`[CREATE] Setting username: ${username}`);
    const usernameSelectors = [
      'input[name="username"]',
      'input[name="user"]',
      'input[name="login"]',
      'input[placeholder*="username"]',
      '#username',
    ];
    
    for (const selector of usernameSelectors) {
      try {
        const input = await page.$(selector);
        if (input) {
          await input.fill(username);
          break;
        }
      } catch (e) {}
    }

    // Fill in the password
    console.log(`[CREATE] Setting password`);
    const passwordSelectors = [
      'input[name="password"]',
      'input[name="pass"]',
      'input[type="password"]',
      '#password',
    ];
    
    for (const selector of passwordSelectors) {
      try {
        const input = await page.$(selector);
        if (input) {
          await input.fill(password);
          break;
        }
      } catch (e) {}
    }

    // Set expiry/duration
    console.log(`[CREATE] Setting duration: ${planMonths} month(s)`);
    const durationSelectors = [
      'select[name="exp_date"]',
      'select[name="duration"]',
      'select[name="months"]',
      'select[name="package"]',
      '#exp_date',
      '#duration',
    ];

    for (const selector of durationSelectors) {
      try {
        const select = await page.$(selector);
        if (select) {
          // Try to select by value or label
          await select.selectOption({ index: planMonths }).catch(() => {});
          break;
        }
      } catch (e) {}
    }

    // Look for bouquet/package selection (select all or default)
    const bouquetSelectors = [
      'select[name="bouquet"]',
      'select[name="bouquet[]"]',
      '#bouquet',
    ];
    
    for (const selector of bouquetSelectors) {
      try {
        const select = await page.$(selector);
        if (select) {
          // Select all options if it's a multi-select
          const options = await select.$$('option');
          if (options.length > 0) {
            const values = await Promise.all(options.map(o => o.getAttribute('value')));
            await select.selectOption(values.filter(v => v));
          }
          break;
        }
      } catch (e) {}
    }

    // Submit the form
    console.log('[CREATE] Submitting form...');
    const submitButtons = [
      'button:has-text("Add")',
      'button:has-text("Create")',
      'button:has-text("Save")',
      'button:has-text("Submit")',
      'input[type="submit"]',
      'button[type="submit"]',
      '.btn-primary',
      '#submit',
    ];

    for (const selector of submitButtons) {
      try {
        const btn = await page.$(selector);
        if (btn) {
          await btn.click();
          await page.waitForTimeout(3000);
          break;
        }
      } catch (e) {}
    }

    // Check for success or get any error
    const pageText = await page.evaluate(() => document.body.innerText.toLowerCase());
    const success = pageText.includes('success') || 
                   pageText.includes('created') || 
                   pageText.includes('added') ||
                   pageText.includes(username.toLowerCase());

    if (!success && (pageText.includes('error') || pageText.includes('exists') || pageText.includes('duplicate'))) {
      // Username might exist, try with a random suffix
      const altUsername = `${username}${Math.floor(Math.random() * 1000)}`;
      console.log(`[CREATE] Username may exist, trying: ${altUsername}`);
      
      // Could retry here with alternate username if needed
      throw new Error('Username may already exist');
    }

    console.log(`[CREATE] Account created: ${username}`);

    // Take screenshot for debugging
    await page.screenshot({ path: `/tmp/create-success-${Date.now()}.png` });

    // Send credentials email via omega-support
    let emailSent = false;
    if (customerEmail) {
      try {
        const emailRes = await fetch('http://localhost:5002/api/send-credentials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: customerEmail,
            username,
            password,
            plan: `${planMonths} Month`,
          }),
        });
        const emailResult = await emailRes.json();
        emailSent = emailResult.success;
        console.log(`[CREATE] Email ${emailSent ? 'sent' : 'failed'} to ${customerEmail}`);
      } catch (emailErr) {
        console.error('[CREATE] Email send error:', emailErr.message);
      }
    }

    res.json({
      success: true,
      username,
      password,
      expiresIn: `${planMonths} month(s)`,
      emailSent,
    });

  } catch (error) {
    console.error('[CREATE] Error:', error.message);
    
    // Take screenshot on error for debugging
    if (page) {
      try {
        await page.screenshot({ path: `/tmp/create-error-${Date.now()}.png` });
      } catch (e) {}
    }

    res.status(500).json({
      error: error.message,
      username,
    });

  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
});

// Renew subscription in IPTV panel
app.post('/api/renew', async (req, res) => {
  const { iptvUsername, planMonths = 1, panelUrl, panelUser, panelPass } = req.body;

  if (!iptvUsername || !panelUrl || !panelUser || !panelPass) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  console.log(`[RENEW] Starting renewal for user: ${iptvUsername}`);
  
  let context = null;
  let page = null;
  
  try {
    const browser = await getBrowser();
    context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1280, height: 720 },
    });
    page = await context.newPage();

    // Navigate to panel login
    console.log('[RENEW] Navigating to panel...');
    await page.goto(panelUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // Login
    console.log('[RENEW] Logging in...');
    await page.fill('input[name="username"], input[type="text"]', panelUser);
    await page.fill('input[name="password"], input[type="password"]', panelPass);
    await page.click('button[type="submit"], input[type="submit"], .login-btn, #login-btn');
    
    // Wait for dashboard
    await page.waitForTimeout(3000);
    
    // Navigate to users/lines section
    console.log('[RENEW] Finding user management...');
    const userLinks = [
      'a:has-text("Users")',
      'a:has-text("Lines")',
      'a:has-text("Subscribers")',
      'a:has-text("Manage Users")',
      '[href*="user"]',
      '[href*="line"]',
    ];
    
    for (const selector of userLinks) {
      try {
        const link = await page.$(selector);
        if (link) {
          await link.click();
          await page.waitForTimeout(2000);
          break;
        }
      } catch (e) {}
    }

    // Search for the user
    console.log(`[RENEW] Searching for user: ${iptvUsername}`);
    const searchSelectors = [
      'input[name="search"]',
      'input[placeholder*="search"]',
      'input[type="search"]',
      '#search',
      '.search-input',
    ];
    
    for (const selector of searchSelectors) {
      try {
        const searchInput = await page.$(selector);
        if (searchInput) {
          await searchInput.fill(iptvUsername);
          await page.keyboard.press('Enter');
          await page.waitForTimeout(2000);
          break;
        }
      } catch (e) {}
    }

    // Find and click edit/extend button for the user
    console.log('[RENEW] Finding extend option...');
    
    const editActions = [
      `tr:has-text("${iptvUsername}") button:has-text("Edit")`,
      `tr:has-text("${iptvUsername}") button:has-text("Extend")`,
      `tr:has-text("${iptvUsername}") a:has-text("Edit")`,
      `tr:has-text("${iptvUsername}") .edit-btn`,
      `tr:has-text("${iptvUsername}") .fa-edit`,
      `tr:has-text("${iptvUsername}") [title="Edit"]`,
      `[data-username="${iptvUsername}"] button`,
    ];

    let foundAction = false;
    for (const selector of editActions) {
      try {
        const btn = await page.$(selector);
        if (btn) {
          await btn.click();
          await page.waitForTimeout(2000);
          foundAction = true;
          break;
        }
      } catch (e) {}
    }

    if (!foundAction) {
      try {
        await page.click(`text="${iptvUsername}"`);
        await page.waitForTimeout(2000);
        foundAction = true;
      } catch (e) {}
    }

    // Look for extend/duration controls
    console.log('[RENEW] Setting extension duration...');
    
    const durationSelectors = [
      'select[name="duration"]',
      'select[name="exp_date"]',
      'select[name="months"]',
      'input[name="duration"]',
      '#duration',
      '.duration-select',
    ];

    for (const selector of durationSelectors) {
      try {
        const durationInput = await page.$(selector);
        if (durationInput) {
          const tagName = await durationInput.evaluate(el => el.tagName);
          if (tagName === 'SELECT') {
            await durationInput.selectOption({ label: `${planMonths} Month` });
          } else {
            await durationInput.fill(String(planMonths));
          }
          break;
        }
      } catch (e) {}
    }

    // Find and click save/extend/submit button
    console.log('[RENEW] Submitting extension...');
    const saveButtons = [
      'button:has-text("Save")',
      'button:has-text("Extend")',
      'button:has-text("Update")',
      'button:has-text("Apply")',
      'input[type="submit"]',
      'button[type="submit"]',
      '.save-btn',
      '#save-btn',
    ];

    for (const selector of saveButtons) {
      try {
        const btn = await page.$(selector);
        if (btn) {
          await btn.click();
          await page.waitForTimeout(3000);
          break;
        }
      } catch (e) {}
    }

    // Check for success indicators
    const successIndicators = await page.evaluate(() => {
      const text = document.body.innerText.toLowerCase();
      return text.includes('success') || 
             text.includes('updated') || 
             text.includes('extended') ||
             text.includes('saved');
    });

    console.log(`[RENEW] Completed for ${iptvUsername}, success indicators: ${successIndicators}`);

    res.json({
      success: true,
      username: iptvUsername,
      monthsAdded: planMonths,
      successIndicators,
    });

  } catch (error) {
    console.error('[RENEW] Error:', error.message);
    
    if (page) {
      try {
        await page.screenshot({ path: `/tmp/renewal-error-${Date.now()}.png` });
      } catch (e) {}
    }

    res.status(500).json({
      error: error.message,
      username: iptvUsername,
    });

  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  if (browser) {
    await browser.close();
  }
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`Omega Renewal Automation running on port ${PORT}`);
});
