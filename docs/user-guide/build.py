# Builds guide.html (BrittVideo Desk — User Guide). Rendered to PDF by Chromium.
import html, re

out = []
def raw(s): out.append(s)
def esc(s): return html.escape(s)

def fmt(s):
    """**BUTTON** -> bold button chip; *text* -> what you see on screen; [Menu] -> menu name."""
    s = esc(s)
    s = re.sub(r'\*\*(.+?)\*\*', r'<b class="btn">\1</b>', s)
    s = re.sub(r'\*(.+?)\*', r'<i class="see">\1</i>', s)
    s = re.sub(r'\[(.+?)\]', r'<b class="menu">\1</b>', s)
    return s

chap_no = [0]
step_no = [0]
def part(title, intro=''):
    raw(f'<section class="part"><div class="partlabel">PART</div><h1>{esc(title)}</h1>' + (f'<p class="lead">{fmt(intro)}</p>' if intro else '') + '</section>')
def chapter(title, intro=''):
    chap_no[0] += 1
    raw(f'<h2 id="c{chap_no[0]}"><span class="num">{chap_no[0]}</span>{esc(title)}</h2>')
    if intro: raw(f'<p class="lead">{fmt(intro)}</p>')
def steps(*items):
    raw('<ol class="steps">')
    for it in items:
        step_no[0] += 1
        raw(f'<li><span class="sn">{step_no[0]}</span><div>{fmt(it)}</div></li>')
    raw('</ol>')
def p(s): raw(f'<p>{fmt(s)}</p>')
def bullets(*items): raw('<ul class="bul">' + ''.join(f'<li>{fmt(i)}</li>' for i in items) + '</ul>')
def tip(s, kind='tip', label='Good to know'): raw(f'<div class="box {kind}"><b>{label}</b> {fmt(s)}</div>')
def shot(name, cap, size='full'):
    raw(f'<figure class="{size}"><img src="img/{name}.jpg"><figcaption>{fmt(cap)}</figcaption></figure>')
def check():
    raw('<div class="check"><div class="cq"><span class="cb"></span> Everything in this chapter matched &nbsp;&nbsp; <span class="cb"></span> Something did not match — step number(s): ________</div>'
        '<div class="lines"><b>My notes and corrections:</b><div class="l"></div><div class="l"></div><div class="l"></div></div></div>')
def pagebreak(): raw('<div class="pb"></div>')

# ------------------------------------------------------------------ COVER
raw('''<section class="cover">
<div class="logo">▶</div>
<div class="brand">BrittVideo Desk</div>
<h1 class="ctitle">User Guide</h1>
<p class="csub">Step by step, from your very first sign-in<br>to delivering a finished Video Kit</p>
<div class="cmeta">Version 3.0.1 · October 2026<br><b>Owner test edition</b> — please mark corrections in the boxes at the end of each chapter</div>
</section>''')

# ------------------------------------------------------------------ HOW TO USE
raw('<h2 class="nonum">How to use this guide</h2>')
bullets(
    'Do the steps **in order**, one at a time. Each step has a number.',
    'Words in **BOLD BUTTONS** are the exact buttons on the screen. Words like [Prospects] are names in the menu. Words in *italics* are what you should see.',
    'The pictures come from a brand-new, empty Desk. The business in them, *Sunrise Family Dental*, is made up for this guide. Its website address in the pictures (*127.0.0.1:4000*) is a test address — with real clients you will see their real website.',
    'At the end of each chapter there is a box. Tick whether everything matched, and write down anything that was wrong, confusing or missing. Those notes become the corrections for the resale edition.',
    'Use the **TEST** copy of the Desk while you learn. Nothing you do there charges real money or contacts real people.',
)
tip('If anything ever goes wrong, press **GET SUPPORT** at the top left. The Desk writes up the technical details for you. You never need to figure out what broke.', 'help', 'If you get stuck')

raw('<h2 class="nonum">What the Desk does — the big picture</h2>')
p('The Desk runs a local video business from one place. Every client follows the same path:')
raw('''<div class="flow">
<div><b>1</b>Find a prospect</div><span>→</span><div><b>2</b>Show a demo</div><span>→</span><div><b>3</b>They become a client</div><span>→</span>
<div><b>4</b>Build the Video Kit</div><span>→</span><div><b>5</b>Approve &amp; deliver</div></div>''')
p('A *prospect* is a business you hope to sell to. When they buy, they become a *client*, and the Desk creates their *project* automatically. A project is the set of videos you make for them.')
p('The Desk sells two packages, and the prices can be changed in Settings:')
bullets('**Standard** — $597 one time: a website video, social videos in three shapes, and an email video.',
        '**Premier** — $997 plus $149 a month: the same kit, plus hosting, a monthly report and a fresh video every quarter.')

raw('<h2 class="nonum">Contents</h2><div id="toc"></div>')
pagebreak()

# ================================================================== PART 1
part('Getting started', 'Your first ten minutes: sign in, find your way around, and make the text comfortable to read.')

chapter('Sign in for the very first time', 'The first person to open a new Desk becomes its owner, called the *Super User*. This happens only once.')
steps('Open the Desk address in Safari (your developer gives you the address).',
      'You see *Welcome — set up BrittVideo*. Type **your name** and **your email**.',
      'Choose a password of **at least 12 characters**. A short sentence you will remember works well, for example *sunrise morning coffee 2026*.',
      'Press **CREATE MY SUPER USER ACCOUNT**. The Desk opens on the [Command Center].')
shot('01_first_setup', 'The welcome screen, seen only once on a brand-new Desk.', 'half')
tip('Write your password down and keep it somewhere safe. If you forget it, only another Super User can reset it.', 'warn', 'Important')
check()

chapter('Find your way around', 'Every screen has the same dark bar at the top and the same menu under it.')
shot('03_top_bar', 'The top bar.')
p('From left to right, the top bar shows:')
bullets('*BrittVideo* — the Desk\'s name.',
        'A yellow label such as *DEVELOPMENT — test data only* or *TEST*. It means you are in a practice copy. The real (live) Desk has no yellow label.',
        'A green or orange pill. Green *Work Saved & Protected* means all is well. Orange *Something needs your attention* means the Desk wants you to look at [System Health]. On a brand-new Desk it is orange until the first backup exists (Chapter 9).',
        'The **search box** — type part of any name to jump to a client, prospect or project.',
        '**A**, **A+**, **A++** — the text size.',
        '**GET SUPPORT**, your name and role, and **Sign out**.')
p('The menu under it takes you to each part of the Desk:')
raw('''<table class="ref"><tr><th>Menu</th><th>What it is for</th></tr>
<tr><td>Command Center</td><td>Your home page: what needs you today, work in progress, sales, revenue.</td></tr>
<tr><td>Prospects</td><td>Businesses you hope to sell to. Add, edit, start demos.</td></tr>
<tr><td>Demo &amp; Sales</td><td>Start an iPad demo, a Zoom demo, or send a Demo Link.</td></tr>
<tr><td>Clients</td><td>Every business that bought, with their orders and history.</td></tr>
<tr><td>Projects</td><td>Every video project and its approval status. The Builder opens from here.</td></tr>
<tr><td>Quick Video</td><td>One short video (thank-you, review request, promotion…) without a full kit.</td></tr>
<tr><td>Image Library</td><td>All your pictures, in folders by business.</td></tr>
<tr><td>System Health</td><td>Is everything saved and backed up? Backups live here.</td></tr>
<tr><td>Settings</td><td>Prices, people, connections, demo videos, importing old work.</td></tr></table>''')
shot('02_command_center_empty', 'The Command Center on a brand-new Desk. The yellow box only says no backup exists yet.')
p('The Command Center has three big buttons at the top right — **+ NEW PROSPECT**, **START A DEMO** and **RECORD A SALE** — and these boxes:')
bullets('*Needs attention today* — new clients waiting to start, payments to record, approvals to redo.',
        '*Production* — projects being built.', '*Sales* — how many open prospects you have.',
        '*Premier — quarterly videos* — Premier clients whose next video is due.',
        '*Quick Video* — the short-video purposes, with **BUILD A QUICK VIDEO**.',
        '*Revenue snapshot* — sales this month and monthly Premier income (a simple snapshot, not accounting).')
check()

chapter('Make the text comfortable to read')
steps('At the top right, press **A++**. Everything gets bigger, and the menu wraps onto more lines.',
      'Press **A+** to go back to the normal large size, or **A** for smaller text.')
shot('04_text_xl', 'The Desk with **A++** (extra-large text).')
tip('Each device remembers its own size, so your iPad and your Mac can be different.')
check()

chapter('Signing in later, and the lock screen')
steps('Open the Desk address. Type your **Email** and **Password** and press **SIGN IN**.',
      'When you finish for the day, press **Sign out** at the top.')
shot('18_sign_in', 'The normal sign-in screen (shown here on an iPad).', 'half')
p('After an iPad demo, the Desk *locks itself* so a prospect cannot see your business information. You will see *BrittVideo is locked*. Type your password and press **UNLOCK** (more in Chapter 13).')
check()

# ================================================================== PART 2
part('Set up your Desk (do this once)', 'Before your first sale: check your prices, add any helpers, load your demo videos and make the first backup.')

chapter('Check your prices', 'Only the Super User can change prices.')
steps('Open [Settings]. The **Pricing** tab opens first.',
      'Under *Default prices* you see the Premier Video Kit, Quick Video, Standard Video Kit and Premier Membership prices.',
      'To change a price, type the new number, add a **Note** (why you changed it), press **SAVE NEW DEFAULT PRICES**, then **YES, SAVE NEW PRICES**.')
shot('05_settings_pricing', 'Settings → Pricing. On the right is exactly what prospects see.')
tip('New prices apply to future sales only. Every past sale, agreement and Premier membership keeps the price it was sold at. The *Price history* list on the right records every change.')
tip('Quick Video has no set price on purpose. You type the agreed price on each sale.', 'tip', 'Note')
check()

chapter('Add a helper or your developer (optional)', 'Everyone gets their own login. Never share yours.')
steps('Open [Settings] and press the **Users** tab.', 'Press **+ ADD PERSON**.',
      'Type their **Name** and **Email**. Choose a **Role**: *Admin* for your developer or a trusted helper; *User* for day-to-day work only.',
      'Type a **Temporary password** and give it to them privately. They must choose their own the first time they sign in.',
      'Press **CREATE ACCOUNT**. They appear under *People with access*.')
shot('06_add_person', 'Adding a person.')
shot('07_users', 'The Users list. Tick *Extra permissions* to allow more (for example *Change default prices*).')
bullets('**TURN OFF ACCESS** stops someone signing in, but keeps everything they did in the history.',
        '**24-HOUR DEVELOPER ACCESS** gives your developer full access for one day only.')
check()

chapter('Load your demo videos', 'Your demo videos are what prospects watch during a demo. One library feeds the iPad demo, the Zoom demo and every Demo Link.')
steps('Open [Settings] and press **Demo Library**. A new Desk already lists ready-made examples for each industry.',
      'Press **EDIT** on an item, or **+ ADD DEMO ITEM** for a new one.',
      'Fill in **Title**, **Description**, **Industry**, **Type**, **Length (seconds)** and **Format**.',
      'In **Video link** paste a Vimeo or YouTube address starting with *https://*. Without a link, the demo shows a dark placeholder box with only the description.',
      'Under **Whose work is this?** choose *My own sample*, or a client\'s video. A client\'s video is shown only if you record how they gave permission.',
      'Set it to *Shown* or *Hidden* and press **SAVE**.')
shot('09_demo_library', 'Settings → Demo Library.')
check()

chapter('Connections (later phases)')
p('Open [Settings] → **Integrations**. This is where the keys for Square card payments, HeyGen video production, Vimeo hosting and email/text messages go. Keys are stored encrypted and never shown again.')
shot('08_integrations', 'Settings → Integrations. Most connections arrive in later updates.')
tip('In this version, card payments are tested with a test card, video production is done outside the Desk, and no emails or texts are sent to customers. See *Not in the Desk yet* at the end of this guide.', 'warn', 'Not active yet')
check()

chapter('Make your first backup', 'The Desk backs itself up every night. Making one now clears the orange *Something needs your attention* pill on a new Desk.')
steps('Open [System Health].', 'Press **MAKE A BACKUP NOW**. You see *Backup created and checked.*',
      'Refresh the page (or open another page). The top pill turns green: *Work Saved & Protected*.')
shot('45_health', 'System Health after the first backup.')
check()

# ================================================================== PART 3
part('Finding clients', 'Add the businesses you want to sell to, and collect pictures from their websites before you visit.')

chapter('Add a prospect')
steps('Open [Prospects] (or press **+ NEW PROSPECT** on the Command Center).',
      'Type the **Business / facility name** and **Website**.',
      'Choose the **Industry**: *Senior Care*, *Dental*, *Attorneys* or *Other*. For *Other*, also type the **Type of business** (for example *Plumbing*).',
      'Add the **Contact name**, **Email** and **Phone** if you have them.',
      'Type anything private in **Private notes** — only you see these; they are never shown in a demo.',
      'Wait a moment: *✓ Saved* appears next to the button. Your typing is kept even if you close the page.',
      'Press **ADD PROSPECT**. You see *… was added.*')
shot('11_prospect_form', 'Adding a prospect.')
shot('12_prospect_list', 'Your prospects, each with its demo buttons.')
tip('Adding the same business twice never makes a duplicate — the Desk says it is *already in your list*.')
p('Next to each prospect: **IPAD DEMO**, **ZOOM DEMO**, **DEMO LINK**, **RECORD A SALE** and **EDIT** (edit details, or **ARCHIVE PROSPECT** when you stop pursuing them).')
check()

chapter('Get pictures from their website', 'Save a business\'s pictures into its own folder. Later, every video for that business can use them without searching again.')
steps('Open [Image Library]. Under *Folders* you see **DENTISTS**, **FACILITIES**, **ATTORNEYS**, **OTHERS** and **GENERAL LIBRARY**.',
      'Press the group (for example **DENTISTS**). Each business in that group has its own folder.',
      'Press the business\'s folder, then **GET PICTURES FROM … WEBSITE**. (Or press **+ GET PICTURES FROM A WEBSITE** and choose the folder in the window.)',
      'The website address is already filled in. Press **SCAN WEBSITE** and wait — up to a minute.',
      'The pictures appear, all ticked. Untick any you do not want. Tiny icons and logos-as-buttons are left out automatically.',
      'Press **SAVE … PICTURES TO …**, then **CLOSE**. The pictures are in that business\'s folder.')
shot('13_folders_dentists', 'Folders: four groups, one folder per business.')
shot('14_scan_results', 'After **SCAN WEBSITE**: tick the pictures to keep.')
shot('15_folder_saved', 'The pictures saved in the Sunrise Family Dental folder.')
tip('Pictures from a business\'s website need that business\'s permission before they appear in a finished video. Each saved picture remembers which web page it came from.', 'warn', 'Permission')
check()

# ================================================================== PART 4
part('Demos and sales', 'Show what you do, and let the prospect sign up and pay — in person, on Zoom, or from a link.')

chapter('Choose the kind of demo')
p('Open [Demo & Sales]. Under *1. Who is the demo for?* choose the prospect (or a new business). Under *2. Start the demo* there are three ways:')
shot('16_demo_sales', 'Demo & Sales.')
bullets('**In person — iPad**: the iPad itself becomes the demo. Chapter 13.',
        '**Remote live — Mac + Zoom**: a separate demo window you share in Zoom. Chapter 14.',
        '**Follow-up Demo Link**: a private link you email or text. Chapter 15.')
tip('In every demo, the prospect sees only your demo videos, what is included and the list prices — never your client list, notes or pricing history.')
check()

chapter('Give an in-person demo on the iPad')
steps('On the iPad, sign in and open [Prospects]. Next to the business press **IPAD DEMO** (or use **START IPAD DEMO** in Demo & Sales).',
      'The screen becomes *Sunrise Family Dental + BrittVideo*. There is no menu and none of your private information. Hand the iPad to the prospect.',
      'They scroll through *What you get*, the *Examples* (press **▶ WATCH** to play one), and *Choose your package*.')
shot('19_ipad_demo_top', 'The iPad demo, as the prospect sees it.', 'half')
steps('When they are ready, they press **BECOME A CLIENT — STANDARD** or **BECOME A CLIENT — PREMIER**.',
      'The business details are already filled in. They type **Your name** and **Email** (phone is optional), read the agreement, type their full name under *Type your full name to sign*, and tick *I have read and agree*.',
      'They press **CONTINUE TO PAYMENT**.')
shot('21_become_client', 'Become a Client: the agreement shows the exact price.', 'half')
steps('On the payment screen, in this version, press **PAY $… WITH TEST CARD** (no real card is charged). **SIMULATE A DECLINED CARD** shows what a declined card looks like.',
      'They see *Welcome to BrittVideo!* — the client, the order and the project now exist.',
      'Take the iPad back. At the bottom left press **Owner: exit demo**. The Desk shows *BrittVideo is locked*.',
      'Type your password and press **UNLOCK**.')
shot('22_payment', 'Payment (test mode in this version).', 'half')
shot('23_welcome', 'The prospect is now a client.', 'half')
shot('24_locked', 'After the demo, the Desk locks until you type your password.', 'half')
check()

chapter('Give a demo over Zoom')
steps('On your Mac, open [Demo & Sales] and choose the prospect.',
      'Press **OPEN ZOOM DEMO WINDOW**. The demo opens in its own window.',
      'In Zoom, choose **Share Screen**, then pick **that demo window only** — not your whole screen.',
      'Walk them through it. They can sign up later from a Demo Link (Chapter 15), or you can record the sale yourself (Chapter 16).')
check()

chapter('Send a follow-up Demo Link')
steps('In [Demo & Sales], choose the prospect.',
      'Under *Follow-up Demo Link*, set **Link works for (days)** (14 is the default).',
      'Leave *Let the prospect sign up from this link* ticked if they may become a client from it.',
      'Press **CREATE DEMO LINK**, then **COPY LINK**, and paste it into your email or text.')
shot('17_demo_link', 'A new Demo Link, and the list of links with views and status.')
tip('For security the full link is shown only once — copy it right away. You can stop a link at any time with **TURN OFF** in the *Demo Links* list.', 'warn', 'Copy it now')
check()

chapter('Record a sale yourself (phone, Zoom or returning client)', 'Use this when the client agreed by phone, on Zoom or by email — or is buying again.')
steps('Press **RECORD A SALE** (Command Center, Prospects, or a client\'s **SELL MORE WORK**).',
      '*1. Business*: the details fill in from the prospect, or type them.',
      '*2. Package*: choose **Standard** or **Premier**. For a one-off price, open *Deal-specific price (optional)* and give a reason. Default prices are not changed.',
      '*3. Agreement*: type the name of the person who agreed under **Agreed by (full name)** and tick that they accepted the agreement.',
      'Press **CREATE SALE**.',
      'Under **How was it paid?** type how you were paid (for example *Check #1042*), then press **RECORD PAYMENT OF $…**. Or press **DO THIS LATER** — the Command Center will remind you.')
shot('29_record_sale', 'Record a Sale.')
check()

# ================================================================== PART 5
part('Your new client', 'Where a new client shows up, and what you can see and change about them.')

chapter('The new client on your Command Center')
p('After a sign-up or a recorded sale, the Command Center shows the client under *Needs attention today* as *New Client — Ready to Start*, and the *Revenue snapshot* includes the sale.')
shot('25_command_center_client', 'A new client waiting to start.')
steps('Press **OPEN PROJECT**. The project page lists the four videos (Website, Social A, Social B, Email), each *Not built yet*.')
shot('26_project', 'The project page: approvals, production and saved versions.')
p('*Saved versions (checkpoints)*: the Desk saves a version at every important step. **RESTORE** goes back to one. Restoring never invents an approval.')
check()

chapter('The client page')
steps('On the project page press **OPEN CLIENT** (or open [Clients] and pick the client).',
      'You see *Details*, *Marketing messages*, *Projects*, *Orders* and *History*.',
      'Press **EDIT DETAILS** to change contact information, or **SELL MORE WORK** to record another sale.')
shot('27_client', 'The client page.')
p('*Marketing messages* — press **CHANGE MARKETING PREFERENCE** to choose *Active*, *Paused* or *Unsubscribed*, then **SAVE PREFERENCE**.')
shot('28_marketing_pref', 'Changing the marketing preference.', 'half')
tip('Messages about their own project are always allowed. Marketing is only sent while *Active*. Once a client is *Unsubscribed*, it can only be reversed at the client\'s own request — the Desk asks how they asked.', 'warn', 'Unsubscribe protection')
check()

# ================================================================== PART 6
part('Build the Video Kit (the Builder)', 'Eight guided steps turn the client\'s website into four approved video scripts, with pictures, ready to produce.')
p('The row of step buttons at the top always shows where you are: a green tick means done, and *YOU ARE HERE: STEP n OF 8* names the current step. You can press any step to go back to it. The client and website come from the sale, so Step 1 is already done.')

chapter('Open the Builder')
steps('Open [Projects]. Press the client\'s *Video Kit* project (the Command Center\'s **OPEN PROJECT** goes to the same place).',
      'Press **OPEN BUILDER**. You arrive at *STEP 2 OF 8 — ANALYZE WEBSITE*.')
shot('30_projects', 'Projects: every project with its status.')
check()

chapter('Step 2 — Analyze the website', 'The Desk reads the client\'s website and lists true statements (facts), each with the page it came from. Nothing is invented.')
steps('Check the **Client website** address. Press **ANALYZE WEBSITE** and wait.',
      'A green box says how many pages, facts and pictures were found.',
      'Read each fact. **Untick** anything wrong, out of date or not useful. Press **EDIT** to reword one.',
      'To add something the website does not say, type it in **Add a fact yourself** and press **ADD FACT**.',
      'Press **NEXT: REVIEW IMAGES →**.')
shot('31_builder_step2', 'Step 2 before analyzing.')
shot('32_facts', 'Facts found, each with *From* and the page it came from.')
tip('Only the facts you keep ticked are used in the videos.')
check()

chapter('Step 3 — Review the pictures')
steps('If you saved pictures to the client\'s folder (Chapter 11), press **ADD … PICTURES FROM … FOLDER**.',
      'Pictures found by the analysis are already here. Add more with **ADD FROM MY IMAGE LIBRARY** or **UPLOAD FROM MY COMPUTER** (JPEG, PNG or WebP).',
      'Untick *Use in this project* for a picture you do not want this time. Press **DO NOT USE** for a picture that must never be used in any video.',
      'Press **NEXT: CHOOSE STORY →**.')
shot('33_images_folder_button', 'The folder button appears when the client\'s folder has pictures not yet in this project.')
shot('34_review_images', 'Pictures for this project.')
check()

chapter('Step 4 — Choose the story')
steps('Choose a **Video story**. Each industry has its own list (dentists, for example: *New Patient Experience*, *Meet the Dentist*, *Office Tour*…).',
      'Choose a **Tone** (*Warm & Emotional*, *Professional*, *Friendly*, *Educational*, *Energetic* or *Premium / Cinematic*).',
      'Choose the **Website Video length** — 30, 60, 90 or 120 seconds — and the **Creation platform** you will produce it in (for example *HeyGen*).',
      'Press **NEXT: BUILD VIDEOS →**.')
shot('35_story', 'Step 4. Social A and Social B are 30 seconds each; the Email Video is 15 seconds.')
check()

chapter('Step 5 — Build the four videos')
steps('Check the summary (story, tone, length, platform, facts kept).',
      'Press **BUILD 4 VIDEOS**. In a few seconds the Desk writes every scene for the Website Video, Social A, Social B and the Email Video.')
shot('36_build', 'Step 5, ready to build.')
check()

chapter('Step 6 — Review the scenes')
steps('Tabs at the top show each video and how many scenes are approved (for example *Website Video · 0/12*).',
      'Read each scene: its *Narration* (the words spoken) and *Visual* (what the picture shows).',
      'To change the words, press **REWRITE SCENE**, edit **Narration — the words spoken**, and press **SAVE SCENE**. The word counter tells you how many words fit the scene.',
      'To change a scene\'s picture, press **CHANGE IMAGE**.',
      'Press **APPROVE SCENE** on each scene, or **APPROVE ALL … SCENES IN …** for the whole video.',
      'Do this on every tab, then press **NEXT: APPROVE →**.')
shot('37_review_scenes', 'Step 6: one tab per video.')
shot('38_rewrite_scene', 'Rewriting a scene.')
tip('Changing approved words removes that scene\'s approval — and the final kit approval — until you approve again. That way, what the client gets is exactly what you approved.', 'warn', 'Approvals follow the words')
check()

chapter('Step 7 — Approve the Complete Video Kit')
steps('Check that every video shows all scenes approved.',
      'Press **APPROVE COMPLETE VIDEO KIT**. You see *✓ COMPLETE VIDEO KIT APPROVED*.',
      'Press **NEXT: DOWNLOAD →**.')
shot('40_kit_approved', 'Every video approved, and the kit approved.')
check()

chapter('Step 8 — Download and deliver')
steps('Press **DOWNLOAD COMPLETE VIDEO KIT**. A zip file is saved to your Downloads folder.',
      'After you send the finished work to the client, choose **How was it delivered?** (for example *Emailed download link*), add a **Note** if you like, and press **RECORD DELIVERY**.',
      'It appears under *Delivery history*.')
shot('42_delivered', 'Step 8 after recording the delivery.')
p('**What is in the kit:** one script file for every video and shape (Website; Social A and B in Landscape 16:9, Vertical 9:16 and Square 1:1; Email), a folder of the pictures used, and a file listing where every fact and picture came from.')
check()

chapter('Producing the actual videos (today)')
p('In this version the Desk prepares and approves everything, but the videos themselves are produced outside the Desk:')
steps('Open the downloaded kit.', 'In your video tool (for example HeyGen), create each video using its script file and the pictures in the kit.',
      'Send the finished videos to the client, then record the delivery (Chapter 26).')
tip('A later update connects the Desk to the video provider so it can produce the videos for you (see *Not in the Desk yet*).')
check()

# ================================================================== PART 7
part('Everyday tools')

chapter('Quick Video — one short video', 'A single purpose-built video without the full kit: thank-you, follow-up, review request, referral request, promotion, announcement, seasonal or email video.')
steps('Open [Quick Video] (or **BUILD A QUICK VIDEO** on the Command Center).',
      'Choose **Who is it for?** (a client or prospect), the **Purpose**, the **Delivery** (*Email*, *Text / SMS Link* or *Website / Social*), the **Length** and the **Tone**.',
      'Optionally personalize it: **Customer first name**, **Service provided**, **Provider / employee name**, **Special message** (and **Promotion / offer details** for a promotion).',
      'Press **BUILD QUICK VIDEO**.',
      'Read the narration. Change words and press **SAVE NARRATION** if needed.',
      'Press **APPROVE SCRIPT**, then **DOWNLOAD SCRIPT**.')
shot('43_quick_form', 'Quick Video.')
shot('44_quick_result', 'The Quick Video script, ready to approve.')
check()

chapter('Image Library — more you can do')
bullets('Choose **ALL PICTURES**, a group, or one business folder to see those pictures. The search box and *All Categories* list narrow it further.',
        '**+ ADD IMAGES FROM MY COMPUTER** adds pictures to the folder you are looking at.',
        'Each picture can be set to *Available*, *Approved* or *Do Not Use*, given a category, **RENAME**d or deleted with **DELETE IMAGE**.',
        '*Not used anywhere* and *Possible duplicates* help you tidy up. Nothing is removed automatically.',
        '*Recently Deleted* keeps deleted pictures until you **RESTORE SELECTED** or **DELETE PERMANENTLY**. A permanently deleted picture can never come back, even from a website scan.')
check()

chapter('Search')
steps('Click the search box at the top and type part of a name (for example *sun*).', 'Press a result to jump to that client, prospect or project.')
shot('47_search', 'Search results.', 'half')
check()

chapter('System Health and GET SUPPORT')
p('[System Health] shows whether your work is saved, storage, backups, automatic tasks and connections. Backups are made every night, checked, and kept 35 days.')
steps('If something looks wrong, press **GET SUPPORT** (top left on every screen).',
      'Type what you were trying to do (optional) and press **PREPARE SUPPORT REPORT**.',
      'Press **SEND FOR SUPPORT** (or **DOWNLOAD REPORT** to save it). Passwords, card details and keys are never included.')
shot('46_support', 'Get Support.', 'half')
check()

# ================================================================== PART 8
part('Quick reference')

raw('<h2 class="nonum">A normal day with the Desk</h2>')
raw('<ol class="plain">' + ''.join(f'<li>{fmt(x)}</li>' for x in [
    'Open the [Command Center]. Check the top pill is green and read *Needs attention today*.',
    'Start any new clients: **OPEN PROJECT** → **OPEN BUILDER**.',
    'Record any payments the Command Center lists.',
    'Add new prospects and save their website pictures.',
    'Give demos, or send Demo Links to follow up.',
    'Finish Builder steps, download approved kits, and record each delivery.',
    'Sign out when you are done.']) + '</ol>')

raw('<h2 class="nonum">Not in the Desk yet</h2>')
raw('''<table class="ref"><tr><th>Coming</th><th>Until then</th></tr>
''' + ''.join(f'<tr><td>{fmt(a)}</td><td>{fmt(b)}</td></tr>' for a, b in [
    ('AI video production (HeyGen)', 'Produce videos yourself from the downloaded kit.'),
    ('Delivery & Vimeo hosting for Premier', 'Send finished files yourself, then **RECORD DELIVERY**.'),
    ('Customer emails & text messages', 'Nothing is sent to customers by the Desk.'),
    ('Premier quarterly scheduling', 'The Command Center shows which videos are due.'),
    ('Live Square card payments', 'Test card in demos; record checks or cash with **RECORD PAYMENT**.')]) + '</table>')

raw('<h2 class="nonum">If something is not right</h2>')
raw('<table class="ref"><tr><th>What you see</th><th>What to do</th></tr>' + ''.join(f'<tr><td>{fmt(a)}</td><td>{fmt(b)}</td></tr>' for a, b in [
    ('Orange *Something needs your attention*', 'Open [System Health]. On a new Desk, press **MAKE A BACKUP NOW**. Otherwise press **GET SUPPORT**.'),
    ('*BrittVideo is locked*', 'A demo ran on this device. Type your password and press **UNLOCK**.'),
    ('I forgot my password', 'Another Super User or Admin can reset it in [Settings] → **Users**.'),
    ('The website analysis found nothing', 'Some websites hide their text and pictures. Add facts with **ADD FACT** and pictures with **UPLOAD FROM MY COMPUTER**.'),
    ('An approval disappeared', 'The words were changed after approving. Read the highlighted scenes, approve them, then approve the kit again.'),
    ('A demo shows a dark box instead of a video', 'Add a **Video link** to that item in [Settings] → **Demo Library**.'),
    ('Anything else', 'Press **GET SUPPORT** and describe what you were doing.')]) + '</table>')

raw('<h2 class="nonum">Corrections already spotted while making this guide</h2>')
p('These were noticed while taking the pictures. They are listed so you can confirm them; they will be fixed before the resale edition.')
bullets('The sign-up *Welcome* screen says *Jim reviews your website…* and the demo footer says *Albuquerque, New Mexico*. For buyers, these must come from each owner\'s own Settings.',
        'The demo *Examples* show dark placeholder boxes until video links are added in the Demo Library.',
        'In Settings → Integrations, one key is labelled *anthropic.api_key*. It should read *AI writer key (optional)*.',
        'After **MAKE A BACKUP NOW**, the top pill stays orange until the page is refreshed.',
        'Pictures named from their file can start with a small letter (for example *hero*).')

raw('<h2 class="nonum">My overall notes</h2>')
raw('<div class="check big"><div class="lines">' + '<div class="l"></div>' * 18 + '</div></div>')

html_doc = open('template.html').read().replace('{{BODY}}', '\n'.join(out))
open('guide.html', 'w').write(html_doc)
print('chapters', chap_no[0], 'steps', step_no[0])
