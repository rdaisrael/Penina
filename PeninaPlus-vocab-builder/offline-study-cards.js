(function () {
    'use strict';

    function escapeHtml(value) {
        return String(value || '').replace(/[&<>"']/g, character => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[character]);
    }

    function safeFileName(value) {
        return String(value || 'Vocabulary Cards')
            .replace(/\.[^.]+$/, '')
            .replace(/[\\/:*?"<>|]+/g, '')
            .replace(/\s+/g, ' ')
            .trim() || 'Vocabulary Cards';
    }

    function toCards(rows) {
        return rows.map((row, index) => ({
            n: index + 1,
            term: row.term || '',
            hebrew: row.hebrewTermTranslation || '',
            english: row.englishTermTranslation || '',
            contextQuote: row.contextQuote || '',
            hebrewTranslation: row.hebrewContextTranslation || '',
            englishTranslation: row.englishContextTranslation || '',
            sourceHebrew: row.hebrewCitation || '',
            sourceEnglish: row.englishCitation || ''
        }));
    }

    function makeApp(title, cards) {
        const safeTitle = escapeHtml(title);
        const cardData = JSON.stringify(cards).replace(/</g, '\\u003c');
        return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>
:root{--bg:#f7f6f3;--panel:#fff;--ink:#1d232a;--muted:#667085;--line:#d9dee7;--accent:#4353ff;--accent2:#eef0ff;--shadow:0 18px 50px rgba(21,28,43,.11);--radius:24px}
*{box-sizing:border-box}body{margin:0;min-height:100vh;color:var(--ink);background:radial-gradient(circle at top left,rgba(67,83,255,.12),transparent 34rem),linear-gradient(180deg,#fbfaf8,var(--bg));font-family:Inter,system-ui,-apple-system,"Segoe UI",Arial,sans-serif}.app{max-width:1180px;margin:auto;padding:28px 20px 54px}
header{display:grid;grid-template-columns:1fr auto;gap:18px;align-items:start;margin-bottom:22px}h1{margin:0;font-size:clamp(28px,4vw,48px);letter-spacing:-.04em;line-height:1.02}.subtitle{margin:10px 0 0;color:var(--muted);line-height:1.45}.badge{display:flex;gap:4px;background:#fff;border:1px solid var(--line);border-radius:999px;padding:9px 13px;font-weight:800;white-space:nowrap}
.layout{display:grid;grid-template-columns:350px 1fr;gap:20px}.panel,.stage{background:rgba(255,255,255,.9);border:1px solid var(--line);box-shadow:var(--shadow);border-radius:var(--radius)}.panel{padding:18px;position:sticky;top:16px;align-self:start}.stage{min-height:590px;padding:clamp(16px,2.5vw,28px);display:flex;flex-direction:column}.section-title{font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.12em;font-weight:800;margin:0 0 10px}
input[type="search"]{width:100%;border:1px solid var(--line);border-radius:14px;padding:12px 13px;font-size:15px;outline:none}input[type="search"]:focus{border-color:var(--accent);box-shadow:0 0 0 4px var(--accent2)}button{border:1px solid var(--line);background:#fff;color:var(--ink);border-radius:14px;padding:11px 12px;font-weight:750;cursor:pointer}button:hover{transform:translateY(-1px);border-color:#b7c0d3}button.primary,button.active{background:var(--accent);border-color:var(--accent);color:#fff}.language-options{display:grid;gap:8px;margin:0 0 18px;border:0;padding:0}.language-choice{display:flex;align-items:center;gap:9px;font-size:14px;font-weight:750;cursor:pointer}.language-choice input{width:18px;height:18px;margin:0;accent-color:var(--accent);cursor:pointer}.orders{display:grid;gap:9px;margin:14px 0}.actions,.controls,.ratings,.stats{display:grid;gap:9px}.actions{grid-template-columns:1fr 1fr}.controls,.ratings,.stats{grid-template-columns:repeat(3,1fr)}
.list{height:260px;overflow:auto;padding-right:9px}.list-item{border:1px solid var(--line);background:#fff;border-radius:16px;padding:11px 12px;margin-bottom:8px;cursor:pointer}.list-item.active{border-color:var(--accent);box-shadow:0 0 0 2px rgba(67,83,255,.24)}.list-item.known{background:#16824f;color:#fff}.list-item.almost{background:#c6a300;color:#fff}.list-item.learning{background:#c93737;color:#fff}.li-top{display:flex;justify-content:space-between;gap:8px;font-weight:800}.li-he,.hebrew{direction:rtl;unicode-bidi:isolate;font-family:"Noto Sans Hebrew","SBL Hebrew","Arial Hebrew",Arial,sans-serif}.li-he{text-align:right;font-size:20px;margin-top:5px}
.topbar{display:flex;align-items:center;gap:14px;margin-bottom:18px;color:var(--muted);font-weight:700}.progress{height:10px;background:#edf0f5;border-radius:999px;overflow:hidden;flex:1}.bar{height:100%;background:var(--accent);transition:width .2s}.card-area{display:grid;place-items:center;min-height:335px}.card{width:min(100%,570px);min-height:323px;position:relative;border:1px solid var(--line);border-radius:24px;background:#fff;box-shadow:0 18px 52px rgba(21,28,43,.12);padding:32px;display:flex;flex-direction:column;justify-content:center;cursor:pointer;transition:transform .18s}.card.flipping{transform:rotateY(90deg)}.corner{position:absolute;top:18px;left:20px;color:var(--muted);font-weight:850;font-size:13px}.side{position:absolute;top:18px;right:20px;color:var(--accent);background:var(--accent2);border-radius:999px;padding:7px 11px;font-size:12px;font-weight:900}.label{color:var(--muted);font-size:13px;text-transform:uppercase;letter-spacing:.11em;font-weight:850;text-align:center;margin-bottom:12px}.main{font-size:clamp(28px,5vw,52px);line-height:1.15;text-align:center;font-weight:850}.main.hebrew{font-size:clamp(34px,6vw,58px)}
.context{border:1px solid var(--line);background:#fff;border-radius:18px;margin-top:10px;padding:11px 14px;text-align:center}.context .label{text-align:left;margin-bottom:5px;font-size:11px}.context p{margin:3px 0;line-height:1.35}.context-he{font-size:19px}.context-he-translation{font-size:15px;color:#384152}.context-en{font-size:14px;color:#384152}.citation{display:flex;justify-content:space-between;gap:14px;color:var(--muted);font-size:12px;margin-top:5px}.controls{margin-top:18px}.ratings{margin-top:10px}.know{background:#16824f;color:#fff}.almost{background:#c6a300;color:#fff}.learning{background:#c93737;color:#fff}.stats{margin-top:14px}.stat{border:1px solid var(--line);border-radius:14px;padding:10px;text-align:center}.stat b{display:block;font-size:20px}.stat span,.note{color:var(--muted);font-size:12px}.note{line-height:1.45;font-size:13px}
@media(max-width:880px){header{grid-template-columns:1fr}.layout{grid-template-columns:1fr}.panel{position:static}.list{height:230px}.controls,.ratings{grid-template-columns:1fr}}
</style>
</head>
<body><div class="app">
<header><div><h1>${safeTitle}</h1><p class="subtitle">Offline bilingual vocabulary practice with adaptive flip cards.</p></div><div class="badge"><span id="count">${cards.length}</span><span>cards</span></div></header>
<main class="layout"><aside class="panel">
<p class="section-title">Find a card</p><input id="search" type="search" placeholder="Search translations, term, or context…" autocomplete="off">
<p class="section-title" style="margin-top:16px">Card Language</p><fieldset class="language-options" aria-label="Card language"><label class="language-choice"><input type="radio" name="cardLanguage" value="both" checked>Hebrew and English</label><label class="language-choice"><input type="radio" name="cardLanguage" value="hebrew">Hebrew Only</label><label class="language-choice"><input type="radio" name="cardLanguage" value="english">English Only</label></fieldset>
<p class="section-title" style="margin-top:16px">Flip order</p><div class="orders"><button id="termFirst" class="active">Term - Hebrew Translation - English Translation</button><button id="translationFirst">Hebrew Translation - English Translation - Term</button></div>
<div class="actions"><button id="shuffle">Shuffle</button><button id="reset">Reset</button></div>
<div class="stats"><div class="stat"><b id="knownCount">0</b><span>Know</span></div><div class="stat"><b id="almostCount">0</b><span>Almost</span></div><div class="stat"><b id="learningCount">0</b><span>Learning</span></div></div>
<p class="note">Keyboard: space flips to the next side; arrow keys move between cards. The context box remains visible.</p><p class="section-title" style="margin-top:16px">Terms</p><div id="list" class="list"></div>
</aside><section class="stage"><div class="topbar"><span id="position"></span><div class="progress"><div id="bar" class="bar"></div></div></div>
<div class="card-area"><article id="card" class="card" tabindex="0"><div id="cardNumber" class="corner"></div><div id="sideNumber" class="side"></div><div id="sideLabel" class="label"></div><div id="mainText" class="main"></div></article></div>
<div class="context"><div class="label">Use in Context</div><p id="contextQuote" class="context-he hebrew"></p><p id="hebrewContext" class="context-he-translation hebrew"></p><p id="englishContext" class="context-en"></p><div class="citation"><span id="englishSource"></span><span id="hebrewSource" class="hebrew"></span></div></div>
<div class="controls"><button id="previous">← Previous</button><button id="flip" class="primary">Flip</button><button id="next">Next →</button></div><div class="ratings"><button class="know" data-rating="known">I know it</button><button class="almost" data-rating="almost">Almost</button><button class="learning" data-rating="learning">Still learning</button></div>
</section></main></div>
<script>
const originalCards=${cardData};let cards=[...originalCards],index=0,sideIndex=0,termFirst=true,languageMode='both',ratings={},animating=false;
const byId=id=>document.getElementById(id);const esc=value=>String(value||'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function searchable(card){return [card.term,card.hebrew,card.english,card.contextQuote,card.hebrewTranslation,card.englishTranslation,card.sourceHebrew,card.sourceEnglish].join(' ').toLowerCase()}
function order(card){const names=termFirst?['term','hebrew','english']:['hebrew','english','term'];const allowed=languageMode==='hebrew'?['term','hebrew']:languageMode==='english'?['english']:names;return names.filter(name=>allowed.includes(name)&&String(card[name]||'').trim())}
function listItemContent(card){if(languageMode==='english')return '<div class="li-top"><span>'+esc(card.english)+'</span><span>#'+card.n+'</span></div>';if(languageMode==='hebrew')return '<div class="li-top"><span></span><span>#'+card.n+'</span></div><div class="li-he">'+esc(card.term)+'</div>';return '<div class="li-top"><span>'+esc(card.english)+'</span><span>#'+card.n+'</span></div><div class="li-he">'+esc(card.term)+'</div>'}
function renderList(){const query=byId('search').value.trim().toLowerCase();const visible=originalCards.filter(card=>!query||searchable(card).includes(query));cards=visible.filter(card=>ratings[card.n]!=='known');if(index>=cards.length)index=0;byId('count').textContent=cards.length;const active=cards[index]&&cards[index].n;byId('list').innerHTML=visible.map(card=>'<div class="list-item '+(ratings[card.n]||'')+' '+(card.n===active?'active':'')+'" data-card="'+card.n+'">'+listItemContent(card)+'</div>').join('');document.querySelectorAll('[data-card]').forEach(item=>item.onclick=()=>{const found=cards.findIndex(card=>card.n===Number(item.dataset.card));if(found>=0){index=found;sideIndex=0;render()}})}
function renderStats(){const values=Object.values(ratings);byId('knownCount').textContent=values.filter(value=>value==='known').length;byId('almostCount').textContent=values.filter(value=>value==='almost').length;byId('learningCount').textContent=values.filter(value=>value==='learning').length}
function setVisible(id,visible){byId(id).hidden=!visible}
function render(){renderList();renderStats();if(!cards.length){byId('position').textContent='0 / 0';byId('bar').style.width='0%';byId('mainText').textContent='No cards remaining';byId('sideLabel').textContent='';byId('sideNumber').textContent='';return}const card=cards[index],sides=order(card);if(sideIndex>=sides.length)sideIndex=0;const side=sides[sideIndex];byId('position').textContent=(index+1)+' / '+cards.length;byId('bar').style.width=((index+1)/cards.length*100)+'%';byId('cardNumber').textContent='Card #'+card.n;byId('sideNumber').textContent=sides.length?(sideIndex+1)+' / '+sides.length:'0 / 0';byId('sideLabel').textContent=!side?'No Content':side==='term'?'Term':side==='hebrew'?'Hebrew Translation of Term':'English Translation of Term';byId('mainText').className='main '+(side&&side!=='english'?'hebrew':'');byId('mainText').textContent=side?(card[side]||''):'No content is available for this card in the selected language.';byId('contextQuote').textContent=card.contextQuote;byId('hebrewContext').textContent=card.hebrewTranslation;byId('englishContext').textContent=card.englishTranslation;byId('hebrewSource').textContent=card.sourceHebrew;byId('englishSource').textContent=card.sourceEnglish;const showHebrew=languageMode!=='english',showEnglish=languageMode!=='hebrew';setVisible('contextQuote',showHebrew);setVisible('hebrewContext',showHebrew);setVisible('hebrewSource',showHebrew);setVisible('englishContext',showEnglish);setVisible('englishSource',showEnglish)}
function move(amount){if(cards.length){index=(index+amount+cards.length)%cards.length;sideIndex=0;render()}}function flip(){if(!cards.length||animating)return;const sides=order(cards[index]);if(sides.length<2)return;animating=true;byId('card').classList.add('flipping');setTimeout(()=>{sideIndex=(sideIndex+1)%sides.length;render();byId('card').classList.remove('flipping');setTimeout(()=>animating=false,190)},180)}
byId('termFirst').onclick=()=>{termFirst=true;sideIndex=0;byId('termFirst').classList.add('active');byId('translationFirst').classList.remove('active');render()};byId('translationFirst').onclick=()=>{termFirst=false;sideIndex=0;byId('translationFirst').classList.add('active');byId('termFirst').classList.remove('active');render()};document.querySelectorAll('input[name="cardLanguage"]').forEach(input=>input.onchange=()=>{languageMode=input.value;sideIndex=0;render()});byId('previous').onclick=()=>move(-1);byId('next').onclick=()=>move(1);byId('flip').onclick=flip;byId('card').onclick=flip;byId('search').oninput=()=>{index=0;sideIndex=0;render()};byId('shuffle').onclick=()=>{originalCards.sort(()=>Math.random()-.5);index=0;sideIndex=0;render()};byId('reset').onclick=()=>{ratings={};originalCards.sort((a,b)=>a.n-b.n);byId('search').value='';index=0;sideIndex=0;render()};document.querySelectorAll('[data-rating]').forEach(button=>button.onclick=()=>{if(!cards[index])return;ratings[cards[index].n]=button.dataset.rating;button.dataset.rating==='known'?render():move(1)});document.addEventListener('keydown',event=>{if(event.target&&['INPUT','TEXTAREA'].includes(event.target.tagName))return;if(event.key==='ArrowRight')move(1);if(event.key==='ArrowLeft')move(-1);if(event.key===' '){event.preventDefault();flip()}});render();
<\/script></body></html>`;
    }

    function download(options) {
        const rows = Array.isArray(options && options.rows) ? options.rows : [];
        if (!rows.length) throw new Error('There are no vocabulary rows to download.');
        const title = safeFileName(options && options.title);
        const blob = new Blob([makeApp(title, toCards(rows))], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = title + ' - Offline Study Cards.html';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    window.PeninaOfflineStudyCards = { download, makeApp, toCards };
})();
