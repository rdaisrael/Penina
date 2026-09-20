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

    function normalizeRuns(value, runs) {
        const text = String(value || '');
        if (!Array.isArray(runs)) return [];
        const normalized = runs
            .map(run => ({ text: String(run && run.text || ''), bold: !!(run && run.bold) }))
            .filter(run => run.text);
        return normalized.map(run => run.text).join('') === text ? normalized : [];
    }

    function toCards(rows) {
        const displayValue = value => String(value === undefined || value === null ? '' : value).trim().toLowerCase() === 'n' ? '' : String(value || '');
        return rows.map((row, index) => ({
            n: index + 1,
            term: displayValue(row.term),
            hebrew: displayValue(row.hebrewTermTranslation),
            english: displayValue(row.englishTermTranslation),
            contextQuote: displayValue(row.contextQuote),
            contextQuoteRuns: normalizeRuns(displayValue(row.contextQuote), row.contextQuoteRuns),
            hebrewTranslation: displayValue(row.hebrewContextTranslation),
            hebrewTranslationRuns: normalizeRuns(displayValue(row.hebrewContextTranslation), row.hebrewContextTranslationRuns),
            englishTranslation: displayValue(row.englishContextTranslation),
            englishTranslationRuns: normalizeRuns(displayValue(row.englishContextTranslation), row.englishContextTranslationRuns),
            sourceHebrew: displayValue(row.hebrewCitation),
            sourceEnglish: displayValue(row.englishCitation),
            ...(row.alternativeAnswers ? { alternativeAnswers: row.alternativeAnswers } : {})
        }));
    }

    // Saved answers are tied to the exact term/definition the teacher reviewed.
    function practiceRows(cards, language) {
        const clean = value => typeof value === 'string' && value.trim().toUpperCase() !== 'N' ? value.trim() : '';
        const key = value => clean(value).normalize('NFKC').toLowerCase().replace(/[\u0591-\u05c7]/g, '').replace(/[^\p{L}\p{N}]/gu, '');
        return cards.flatMap((card, id) => {
            const saved = card.alternativeAnswers?.[language];
            const term = clean(card.term);
            const definition = clean(card[language]) || clean(card.english) || clean(card.hebrew);
            if (!term || !definition || saved?.term !== term || saved?.definition !== definition
                || !Array.isArray(saved.answers) || saved.answers.length !== 4) return [];
            const answers = saved.answers.map(clean), keys = answers.map(key);
            if (new Set(keys).size !== 4 || answers.some((answer, i) => !keys[i] || answer.length > 500
                || keys[i] === key(term) || keys[i] === key(definition)
                || (language === 'hebrew' ? !/[א-ת]/.test(answer) : !/[a-z]/i.test(answer) || /[א-ת]/.test(answer)))) return [];
            return [{ id, term, definition, answers }];
        });
    }

    // Pure game state: no DOM, timers, or network. Also embedded in offline files.
    function createAsteroids(random = Math.random) {
        const width = 900, height = 500;
        const sizes = { large: { radius: 42, points: 20, next: 'medium' }, medium: { radius: 25, points: 50, next: 'small' }, small: { radius: 13, points: 100 } };
        const state = { width, height, score: 300, fuel: 0, wave: 1, hits: 0, correct: 0, incorrect: 0,
            phase: 'question', rocks: [], enemies: [], enemyShots: [], bullets: [], effects: [], cooldown: 0,
            ship: { x: width / 2, y: height / 2, vx: 0, vy: 0, angle: -Math.PI / 2, shield: 2 } };
        const wrap = (value, limit) => (value % limit + limit) % limit;
        function distance(a, b) {
            const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
            return Math.hypot(Math.min(dx, width - dx), Math.min(dy, height - dy));
        }
        function rock(size, x, y) {
            const angle = random() * Math.PI * 2, speed = (size === 'large' ? 35 : size === 'medium' ? 55 : 80) + random() * 25;
            return { size, radius: sizes[size].radius, x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
                angle: random() * Math.PI * 2, spin: random() - .5,
                outline: Array.from({ length: 10 }, () => .75 + random() * .25) };
        }
        function populate() {
            state.enemyShots=[];
            if(state.wave>=2) for(let i=0;i<2+state.wave;i++) state.enemies.push({x:40+i*170,y:30,radius:18,kind:state.wave===2?'martian':'ship',cooldown:1+i*.35});
            for (let i = 0; i < Math.min(2 + state.wave, 7); i++) {
                // New waves arrive at the edge, away from the ship's starting position.
                state.rocks.push(rock('large', i % 2 ? random() * width : 20, i % 2 ? 20 : random() * height));
            }
        }
        function damage(cause) {
            state.score = Math.max(0, state.score - 150);
            state.effects.push({x:state.ship.x,y:state.ship.y,points:-150,ttl:1});state.lastDamage={cause,number:(state.lastDamage?.number||0)+1};
            state.ship.x=width/2;state.ship.y=height/2;state.ship.vx=state.ship.vy=0;state.ship.shield=2;
            if (!state.score) state.phase='gameover';
        }
        function answer(correct) {
            if (state.phase !== 'question') return false;
            if (correct) { state.fuel += 10; state.correct++; state.phase = 'ready'; }
            else { state.score = Math.max(0,state.score-25); state.incorrect++; state.phase = state.score ? 'review' : 'gameover'; }
            return true;
        }
        function nextQuestion() {
            if (state.phase !== 'review') return false;
            state.phase = 'question'; return true;
        }
        function launch() {
            if (state.phase !== 'ready' && state.phase !== 'paused') return false;
            if (state.fuel <= 0 && !state.bullets.length) return false;
            if(state.phase==='ready')state.ship.shield=Math.max(state.ship.shield,3);
            state.phase = 'flying'; return true;
        }
        function pause() { if (state.phase === 'flying') state.phase = 'paused'; }
        function shoot() {
            if (state.phase !== 'flying' || state.fuel <= 0 || state.cooldown > 0) return false;
            const ship = state.ship, dx = Math.cos(ship.angle), dy = Math.sin(ship.angle);
            state.bullets.push({ x: ship.x + dx * 19, y: ship.y + dy * 19, vx: dx * 520 + ship.vx, vy: dy * 520 + ship.vy, ttl: 1.1 });
            state.fuel--; state.cooldown = .18; return true;
        }
        function tick(seconds, controls = {}) {
            if (state.phase !== 'flying') return;
            const dt = Math.min(Math.max(seconds, 0), .035), ship = state.ship;
            state.cooldown = Math.max(0, state.cooldown - dt);
            ship.angle += ((controls.right ? 1 : 0) - (controls.left ? 1 : 0)) * 3.5 * dt;
            if (controls.thrust) { ship.vx += Math.cos(ship.angle) * 220 * dt; ship.vy += Math.sin(ship.angle) * 220 * dt; }
            const speed = Math.hypot(ship.vx, ship.vy);
            if (speed > 280) { ship.vx *= 280 / speed; ship.vy *= 280 / speed; }
            ship.vx *= Math.exp(-.5 * dt); ship.vy *= Math.exp(-.5 * dt);
            ship.x = wrap(ship.x + ship.vx * dt, width); ship.y = wrap(ship.y + ship.vy * dt, height);
            ship.shield = Math.max(0, ship.shield - dt);
            if (controls.fire) shoot();
            state.rocks.forEach(item => { item.x = wrap(item.x + item.vx * dt, width); item.y = wrap(item.y + item.vy * dt, height); item.angle += item.spin * dt; item.arming=Math.max(0,(item.arming||0)-dt); });
            state.bullets.forEach(bullet => { bullet.x += bullet.vx * dt; bullet.y += bullet.vy * dt; bullet.ttl -= dt; if(bullet.x<0||bullet.x>width||bullet.y<0||bullet.y>height)bullet.ttl=0; });
            for (const enemy of state.enemies) {
                const angle=Math.atan2(ship.y-enemy.y,ship.x-enemy.x), speed=enemy.kind==='martian'?55:32;
                enemy.x+=Math.cos(angle)*speed*dt;enemy.y+=Math.sin(angle)*speed*dt;
                if(enemy.kind==='ship' && (enemy.cooldown-=dt)<=0){
                    state.enemyShots.push({x:enemy.x,y:enemy.y,vx:Math.cos(angle)*170,vy:Math.sin(angle)*170,ttl:4});enemy.cooldown=2.1;
                }
            }
            state.enemyShots.forEach(shot=>{shot.x+=shot.vx*dt;shot.y+=shot.vy*dt;shot.ttl-=dt;if(!ship.shield&&shot.ttl>0&&shot.x>=0&&shot.x<=width&&shot.y>=0&&shot.y<=height&&Math.hypot(shot.x-ship.x,shot.y-ship.y)<14){shot.ttl=0;damage('Enemy fire');}});
            state.enemyShots=state.enemyShots.filter(shot=>shot.ttl>0&&shot.x>=0&&shot.x<=width&&shot.y>=0&&shot.y<=height);
            if(state.phase==='gameover')return;
            for (const bullet of state.bullets) {
                if (bullet.ttl <= 0) continue;
                const index = state.rocks.findIndex(item => Math.hypot(item.x-bullet.x,item.y-bullet.y) < item.radius + 3);
                if (index < 0) {
                    const enemyIndex=state.enemies.findIndex(enemy=>Math.hypot(enemy.x-bullet.x,enemy.y-bullet.y)<enemy.radius+3);
                    if(enemyIndex>=0){const enemy=state.enemies.splice(enemyIndex,1)[0];bullet.ttl=0;const points=enemy.kind==='martian'?125:200;state.score+=points;state.effects.push({x:enemy.x,y:enemy.y,points,ttl:.7});}
                    continue;
                }
                const hit = state.rocks.splice(index, 1)[0], spec = sizes[hit.size];
                bullet.ttl = 0; state.score += spec.points; state.hits++;
                state.effects.push({ x: hit.x, y: hit.y, points: spec.points, ttl: .7 });
                if (spec.next) for (let i = 0; i < 2; i++) state.rocks.push({...rock(spec.next, hit.x, hit.y),arming:.35});
            }
            state.bullets = state.bullets.filter(bullet => bullet.ttl > 0);
            state.effects = state.effects.filter(effect => (effect.ttl -= dt) > 0);
            if(state.phase==='gameover')return;
            if (!ship.shield && state.rocks.some(item => !item.arming && distance(item, ship) < item.radius + 10)) damage('Asteroid collision');
            if (!ship.shield && state.enemies.some(item=>distance(item,ship)<item.radius+10)) damage('Enemy collision');
            if(state.phase==='gameover')return;
            if (!state.rocks.length && !state.enemies.length) {
                if(state.wave===3){state.phase='won';return;}
                state.wave++; populate(); ship.shield=2;
            }
            // Let the last shot finish before freezing for the next vocabulary question.
            if (!state.fuel && !state.bullets.length) state.phase = 'question';
        }
        populate();
        return { state, answer, nextQuestion, launch, pause, shoot, tick };
    }

    function mountAsteroids({ board, rows, createEngine, setFeedback, setProgress }) {
        const doc = board.ownerDocument, game = createEngine(), state = game.state;
        board.innerHTML = `<div class="asteroids-hud"><span>Score <b id="asteroidScore">300</b></span><span>Fuel cells <b id="asteroidFuel">0</b> / 10</span><span>Round <b id="asteroidWave">1</b></span><button id="asteroidPause" type="button" disabled>Pause</button></div><div class="asteroids-arena"><canvas id="asteroidCanvas" width="900" height="500" tabindex="0" aria-label="Asteroids play area. Left and right arrows turn, up arrow thrusts, space fires. Press P to pause.">Use a browser with canvas support to play Asteroids.</canvas><div id="asteroidOverlay" class="asteroids-overlay"><section id="asteroidQuestion" class="asteroids-question" aria-labelledby="asteroidQuestionTitle"></section></div></div><div class="asteroids-controls" aria-label="Spaceship controls"><button type="button" data-flight="left" aria-label="Turn left">↶ Left</button><button type="button" data-flight="thrust" aria-label="Thrust">↑ Thrust</button><button type="button" data-flight="right" aria-label="Turn right">Right ↷</button><button type="button" data-flight="fire" aria-label="Fire">● Fire</button></div><p class="asteroids-rules">Large asteroid: <b>20</b> · Medium: <b>50</b> · Small: <b>100</b> · Martian: <b>125</b> · Enemy ship: <b>200</b> · Collision / enemy fire: <b>−150</b> · Wrong answer: <b>−25</b> · Start: <b>300</b><br>Arrows or W/A/D to fly · Space to fire · P to pause. You can also hold the buttons above.</p>`;
        const find = id => board.querySelector('#' + id);
        const canvas = find('asteroidCanvas'), ctx = canvas.getContext('2d');
        const overlay = find('asteroidOverlay'), question = find('asteroidQuestion'), pause = find('asteroidPause');
        const keyboard = new Set(), pointers = new Map(), aborter = new AbortController();
        const listen = (target, type, handler) => target.addEventListener(type, handler, { signal: aborter.signal });
        let frame, stopped = false, previous = 0, deck = [], lastRow = null, seenPhase = '', damageSeen = 0;
        const stars = Array.from({ length: 80 }, (_, i) => ({ x: (i * 137.7) % state.width, y: (i * 71.3) % state.height }));
        function shuffled(values) {
            const result = values.slice();
            for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
            return result;
        }
        function clearControls() { keyboard.clear(); pointers.clear(); }
        function update() {
            find('asteroidScore').textContent = state.score;
            find('asteroidFuel').textContent = state.fuel;
            find('asteroidWave').textContent = state.wave;
            const progress = `${state.correct} correct answers · ${state.incorrect} incorrect · ${state.hits} asteroids hit`;
            setProgress(progress);
            if(state.lastDamage && state.lastDamage.number!==damageSeen){damageSeen=state.lastDamage.number;setFeedback(state.lastDamage.cause+' — −150 points. Shield restored briefly.');}
            pause.disabled = !['flying', 'paused'].includes(state.phase);
            pause.textContent = state.phase === 'paused' ? 'Resume' : 'Pause';
            board.querySelectorAll('[data-flight]').forEach(node => { node.disabled = state.phase !== 'flying'; });
        }
        function el(tag, text, className) {
            const node = doc.createElement(tag); node.textContent = text;
            if (className) node.className = className;
            return node;
        }
        function action(text, onClick) {
            const node = el('button', text, 'asteroids-continue'); node.type = 'button'; node.onclick = onClick; return node;
        }
        function resume() {
            if (!game.launch()) return;
            clearControls(); overlay.hidden = true; setFeedback(''); seenPhase = state.phase;
            update(); canvas.focus(); previous = 0;
        }
        function ask() {
            clearControls(); overlay.hidden = false; question.replaceChildren(); setFeedback('');
            if (!deck.length) {
                deck = shuffled(rows);
                if (deck.length > 1 && deck[0].id === lastRow?.id) [deck[0], deck[1]] = [deck[1], deck[0]];
            }
            const row = deck.shift(); lastRow = row;
            const heading = el('h3', state.correct || state.incorrect ? 'Refuel: earn 10 fuel cells' : 'Answer a word to launch');
            heading.id = 'asteroidQuestionTitle'; heading.tabIndex = -1;
            const term = el('p', row.term, 'asteroids-term'); term.dir = 'auto';
            const instruction = el('p', 'Choose the correct definition.');
            const options = el('div', '', 'asteroids-options');
            const result = el('p', '', 'asteroids-result'); result.setAttribute('role', 'status');
            shuffled([row.definition, ...row.answers]).forEach(answer => {
                const node = el('button', answer); node.type = 'button'; node.dir = 'auto';
                node.onclick = () => {
                    const correct = answer === row.definition;
                    if (!game.answer(correct)) return;
                    options.querySelectorAll('button').forEach(choice => {
                        choice.disabled = true;
                        if (choice.textContent === row.definition) choice.classList.add('correct');
                    });
                    if (!correct) node.classList.add('wrong');
                    if(state.phase==='gameover'){showEnd();update();return;}
                    if(correct){resume();setFeedback('Correct! +10 fuel cells. Fly!');return;}
                    const message = correct ? 'Correct! You earned 10 fuel cells.' : `Incorrect. −25 points. The correct answer is: ${row.definition}. No new fuel.`;
                    result.textContent = message;
                    const proceed = action('Next question', () => {
                        if (game.nextQuestion()) { ask(); update(); }
                    });
                    question.append(proceed); update(); proceed.focus();
                };
                options.append(node);
            });
            question.append(heading, term, instruction, options, result);
            update(); heading.focus();
        }
        function showPause() {
            game.pause(); clearControls();
            if (state.phase !== 'paused') return;
            overlay.hidden = false;
            const heading = el('h3', 'Paused'); heading.id = 'asteroidQuestionTitle';
            const resumeButton = action('Resume flight', resume);
            question.replaceChildren(heading, el('p', 'Your ship, score, and fuel cells are waiting.'), resumeButton);
            seenPhase = state.phase; update(); resumeButton.focus();
        }
        pause.onclick = () => state.phase === 'paused' ? resume() : showPause();
        const keys = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'thrust', KeyW: 'thrust', Space: 'fire' };
        listen(doc, 'keydown', event => {
            if (event.code === 'KeyP' && ['flying', 'paused'].includes(state.phase) && !event.repeat) { event.preventDefault(); pause.click(); return; }
            // Keep Tab, button activation, and all question controls native.
            if (state.phase !== 'flying' || !keys[event.code] || event.target !== canvas) return;
            event.preventDefault(); keyboard.add(event.code);
            if(keys[event.code]==='fire'&&!event.repeat)game.shoot();
        });
        listen(doc, 'keyup', event => { keyboard.delete(event.code); });
        listen(canvas, 'blur', () => keyboard.clear());
        listen(window, 'blur', showPause);
        listen(doc, 'visibilitychange', () => { if (doc.hidden) showPause(); });
        board.querySelectorAll('[data-flight]').forEach(node => {
            listen(node, 'pointerdown', event => {
                if (state.phase !== 'flying' || event.button !== 0) return;
                event.preventDefault(); node.setPointerCapture(event.pointerId);
                pointers.set(event.pointerId, node.dataset.flight);if(node.dataset.flight==='fire')game.shoot();canvas.focus();
            });
            ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => listen(node, type, event => pointers.delete(event.pointerId)));
            listen(node, 'click', event => {
                // Keyboard users can activate these controls as well as the canvas shortcuts.
                if (event.detail !== 0 || state.phase !== 'flying') return;
                if (node.dataset.flight === 'fire') game.shoot();
                else game.tick(.035, { [node.dataset.flight]: true });
                update();
            });
        });
        function draw(controls) {
            ctx.fillStyle = '#0c1026'; ctx.fillRect(0, 0, state.width, state.height);
            for (const star of stars) { ctx.fillStyle = '#c4c5ee88'; ctx.fillRect(star.x, star.y, 1.6, 1.6); }
            for (const rock of state.rocks) {
                ctx.save(); ctx.translate(rock.x, rock.y); ctx.rotate(rock.angle);
                ctx.beginPath(); rock.outline.forEach((scale, i) => {
                    const angle = i / rock.outline.length * Math.PI * 2, x = Math.cos(angle) * rock.radius * scale, y = Math.sin(angle) * rock.radius * scale;
                    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
                }); ctx.closePath(); ctx.fillStyle = '#292541'; ctx.fill(); ctx.strokeStyle = rock.size === 'small' ? '#ffec55' : '#b1a1e6'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
            }
            ctx.fillStyle = '#ffec55';
            state.bullets.forEach(bullet => { ctx.beginPath(); ctx.arc(bullet.x, bullet.y, 3, 0, Math.PI * 2); ctx.fill(); });
            for(const enemy of state.enemies){
                ctx.save();ctx.translate(enemy.x,enemy.y);ctx.fillStyle=enemy.kind==='martian'?'#72f5a9':'#ff859c';
                ctx.beginPath();ctx.ellipse(0,0,enemy.kind==='martian'?15:23,12,0,0,Math.PI*2);ctx.fill();
                ctx.fillStyle='#11152f';ctx.fillRect(-8,-3,5,5);ctx.fillRect(3,-3,5,5);
                if(enemy.kind==='ship'){ctx.strokeStyle='#fff';ctx.strokeRect(-9,-17,18,9);}ctx.restore();
            }
            ctx.fillStyle='#ff718a';state.enemyShots.forEach(shot=>{ctx.beginPath();ctx.arc(shot.x,shot.y,4,0,Math.PI*2);ctx.fill();});
            const ship = state.ship;
            ctx.save(); ctx.translate(ship.x, ship.y); ctx.rotate(ship.angle);
            if (controls.thrust && state.phase === 'flying') {
                ctx.beginPath(); ctx.moveTo(-10, -5); ctx.lineTo(-24, 0); ctx.lineTo(-10, 5); ctx.fillStyle = '#ffc45c'; ctx.fill();
            }
            ctx.beginPath(); ctx.moveTo(17, 0); ctx.lineTo(-11, -10); ctx.lineTo(-6, 0); ctx.lineTo(-11, 10); ctx.closePath();
            ctx.fillStyle = '#8253d2'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
            if (ship.shield > 0) { ctx.beginPath(); ctx.arc(0, 0, 25, 0, Math.PI * 2); ctx.strokeStyle = '#73e4dd88'; ctx.stroke(); }
            ctx.restore();
            ctx.textAlign = 'center'; ctx.font = 'bold 24px system-ui';
            state.effects.forEach(effect => { ctx.fillStyle = '#ffec55'; ctx.fillText((effect.points>0?'+':'') + effect.points, effect.x, effect.y - (1 - effect.ttl) * 30); });
        }
        function showEnd() {
            clearControls();overlay.hidden=false;
            const won=state.phase==='won', heading=el('h3',won?'Congratulations captain!':'Game over');heading.id='asteroidQuestionTitle';heading.tabIndex=-1;
            question.replaceChildren(heading,el('p',`Final score: ${state.score}`));
            const config=doc.getElementById('peninaClassConfig');
            const settings=config?JSON.parse(config.textContent):{};
            if(won && settings.leaderboardUrl && window.location.protocol!=='file:'){
                const form=el('form',''),label=el('label','Your initials (1–3 letters) '),input=el('input','');
                input.name='initials';input.maxLength=3;input.pattern='[A-Za-z]{1,3}';input.required=true;input.autocomplete='off';input.setAttribute('aria-label','Your initials');
                label.append(input);const submit=el('button','Submit score');submit.type='submit';form.append(label,submit);
                const status=el('p','');status.setAttribute('role','status');
                form.onsubmit=async event=>{event.preventDefault();if(submit.disabled||!form.reportValidity())return;submit.disabled=true;status.textContent='Saving…';
                    try{const response=await fetch(settings.leaderboardUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({initials:input.value.toUpperCase(),score:state.score,rounds:3,runId})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not save score.');form.remove();status.textContent='Score submitted!';showBoard(data.scores);}
                    catch(error){status.textContent=error.message;submit.disabled=false;}
                };question.append(form,status);
            }else if(won){question.append(el('p','Open this set from your class webpage to submit a score to the class board.'));}
            heading.focus();
        }
        const runId = typeof crypto!=='undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
        const leaderboard=el('section','', 'asteroids-leaderboard');board.append(leaderboard);
        function showBoard(scores){leaderboard.replaceChildren(el('h3','🏆 Class Asteroids board — Top 3 all time'));const list=el('ol','');scores.slice(0,3).forEach(entry=>list.append(el('li',`${entry.initials} · ${entry.score.toLocaleString()} points`)));leaderboard.append(scores.length?list:el('p','Be the first captain on the board!'));}
        function animate(time) {
            if (stopped) return;
            const controls = {};
            keyboard.forEach(code => { controls[keys[code]] = true; }); pointers.forEach(control => { controls[control] = true; });
            game.tick(previous ? (time - previous) / 1000 : 0, controls); previous = time;
            if (state.phase === 'question' && seenPhase === 'flying') ask();
            if(['won','gameover'].includes(state.phase) && seenPhase!==state.phase)showEnd();
            seenPhase = state.phase;
            draw(controls); update();
            frame = requestAnimationFrame(animate);
        }
        if (!ctx) {
            board.replaceChildren(el('p', 'Asteroids needs a browser with canvas support. Please try another browser or choose a different practice game.'));
            return () => aborter.abort();
        }
        ask(); seenPhase = state.phase; frame = requestAnimationFrame(animate);
        return () => { stopped = true; cancelAnimationFrame(frame); clearControls(); aborter.abort(); };
    }

    // Embedded in each published or downloaded set; uses its reviewed answer choices.
    function mountChomp({ board, rows: vocabulary }) {
        board.innerHTML = "<div id=\"chomp-game\" aria-label=\"Chomp and Charge vocabulary game\">\n<style>\n#chomp-game{--cc-bg:light-dark(#fff4e6,#211934);--cc-panel:light-dark(#ffffff,#202c41);--cc-text:light-dark(#182b46,#edf3ff);--cc-muted:light-dark(#52647e,#b1c0d7);--cc-line:light-dark(#d7e1ef,#384863);--cc-blue:light-dark(#245cce,#8bb1ff);--cc-maze:light-dark(#f0eaff,#1d163a);--cc-wall:light-dark(#9872e5,#875adb);--cc-dot:light-dark(#516997,#b6c9ed);--cc-yellow:light-dark(#f3aa12,#ffcf49);--cc-pink:light-dark(#e84c91,#ff78b5);--cc-teal:light-dark(#159eaa,#4cdbcf);--cc-orange:light-dark(#e88422,#ffaf5f);font:16px/1.45 system-ui,sans-serif;color:var(--cc-text);max-width:660px;margin:auto;background:var(--cc-bg);border:1px solid var(--cc-line);border-radius:20px;overflow:hidden}\n#chomp-game *{box-sizing:border-box}#chomp-game header{padding:20px 22px 12px;display:flex;justify-content:space-between;align-items:center;gap:12px}#chomp-game h2{font-size:23px;letter-spacing:-.6px;margin:0;font-weight:600}#chomp-game .eyebrow{font-size:11px;letter-spacing:1.5px;color:var(--cc-muted);margin-bottom:4px}#chomp-game button{font:inherit;cursor:pointer;border:1px solid var(--cc-line);background:var(--cc-panel);color:var(--cc-text);border-radius:10px;min-height:44px;padding:9px 14px}#chomp-game button:disabled{opacity:.5;cursor:default}#chomp-game button:hover:not(:disabled){border-color:var(--cc-blue)}#chomp-game .primary{background:var(--cc-blue);color:light-dark(#fff,#12213b);border-color:transparent}#chomp-game .stats{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:0 22px 12px;font-size:13px}#chomp-game .stats b{font-weight:600}#chomp-game .energy{padding:0 22px 16px}#chomp-game .energy-label{display:flex;justify-content:space-between;font-size:12px;margin-bottom:7px;color:var(--cc-muted)}#chomp-game .track{height:7px;border-radius:8px;background:var(--cc-line);overflow:hidden}#chomp-game .fill{height:100%;background:linear-gradient(90deg,var(--cc-pink),var(--cc-yellow));width:0%}#chomp-game .arena{position:relative;margin:0 14px;background:var(--cc-maze);border-radius:12px;overflow:hidden;min-height:340px;display:grid;align-items:center}#chomp-game canvas{display:block;width:100%;height:auto;grid-area:1/1}#chomp-game .shade{position:relative;grid-area:1/1;align-self:stretch;display:grid;place-items:center;background:light-dark(#e9f0fcbb,#121e35bb);padding:12px}#chomp-game [hidden]{display:none!important}#chomp-game .dialog{width:100%;max-width:340px;background:var(--cc-panel);border:1px solid var(--cc-line);border-radius:16px;padding:20px;text-align:center;box-shadow:0 12px 32px #0002}#chomp-game .dialog h3{margin:2px 0 7px;font-size:16px;font-weight:500}#chomp-game .word{font-size:40px;line-height:1.3;margin:4px 0 14px}#chomp-game .choices{display:grid;grid-template-columns:1fr 1fr;gap:8px}#chomp-game .feedback{font-size:13px;margin:12px 0 0;color:var(--cc-muted)}#chomp-game .controls{padding:14px 22px 18px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}#chomp-game .hint{font-size:12px;color:var(--cc-muted);max-width:220px}#chomp-game .pad{display:flex;gap:5px}#chomp-game .pad button{padding:8px 12px}#chomp-game .legend{font-size:12px;color:var(--cc-muted);padding:0 22px 16px}#chomp-game .recap{font-size:14px;white-space:pre-line;margin:12px 0 16px}@media(max-width:420px){#chomp-game header{padding:16px 14px 12px}#chomp-game h2{font-size:20px}#chomp-game .dialog{padding:14px}#chomp-game .controls{padding:12px 14px}#chomp-game .hint{max-width:none}#chomp-game .arena{margin:0 8px}}\n#chomp-game .power-status{margin:0 14px 10px;padding:10px 12px;border-radius:10px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:13px;background:var(--cc-panel);color:var(--cc-text)}#chomp-game .power-status[data-active=\"true\"]{background:var(--cc-yellow);color:#241a08;font-weight:600}#chomp-game #cc-bonus{font-weight:600}\n#chomp-game .wrong-mark{font-size:72px;line-height:1;color:light-dark(#c12949,#ff819c);font-weight:600;margin:4px 0}#chomp-game .dialog[data-review=\"true\"] .feedback{font-size:24px;color:var(--cc-text);margin:10px 0}\n#chomp-game button{white-space:normal;overflow-wrap:anywhere}#chomp-game .word,#chomp-game .feedback{overflow-wrap:anywhere}#chomp-game .dialog{max-width:420px}#chomp-game .arena:has(.shade:not([hidden])){min-height:400px}#chomp-game .choices button{font-size:16px}#chomp-game .word{font-size:32px}#chomp-game .dialog[data-review=\"true\"] .feedback{font-size:20px}\n</style>\n<header><div><div class=\"eyebrow\">PENINA · VOCABULARY ARCADE</div><h2>Chomp &amp; Charge ✨</h2></div><button id=\"cc-pause\" disabled>Pause</button></header>\n<div class=\"stats\"><span>⭐ Score <b id=\"cc-score\">0</b></span><span>🍬 Dots <b id=\"cc-dots\">0 / 0</b></span><span>First try <b id=\"cc-accuracy\">—</b></span><span>❤️ Lives <b id=\"cc-lives\">3</b></span></div>\n<div class=\"energy\"><div class=\"energy-label\"><span id=\"cc-status\">Answer to power the maze</span><span id=\"cc-seconds\">0 / 8s</span></div><div class=\"track\" role=\"progressbar\" aria-label=\"Energy\" aria-valuemin=\"0\" aria-valuemax=\"100\" aria-valuenow=\"0\"><div class=\"fill\"></div></div></div>\n<div class=\"power-status\"><span id=\"cc-power\">⚡ Find a large dot to chase ghosts</span><span id=\"cc-bonus\" aria-live=\"polite\"></span></div><div class=\"arena\"><canvas width=\"570\" height=\"390\" role=\"img\" aria-label=\"Maze with collectible dots, four power pellets, two ghosts, and your yellow player\"></canvas><div class=\"shade\"><section class=\"dialog\" aria-label=\"Vocabulary question\"><div class=\"eyebrow\" id=\"cc-tag\">Answer to Enter Maze</div><h3 id=\"cc-prompt\" hidden></h3><div class=\"word\" dir=\"auto\"></div><div class=\"choices\"></div><div class=\"wrong-mark\" aria-label=\"Incorrect answer\" hidden>✕</div><p class=\"feedback\" aria-live=\"polite\"></p><div class=\"recap\" hidden></div><button class=\"primary\" id=\"cc-continue\" hidden>Enter the maze →</button></section></div></div>\n<div class=\"controls\"><div class=\"hint\">Move with arrow keys or WASD.<br>Clear every dot. Avoid the ghosts.</div><div class=\"pad\" aria-label=\"Movement\"><button aria-label=\"Move left\" data-dir=\"-1,0\">←</button><button aria-label=\"Move up\" data-dir=\"0,-1\">↑</button><button aria-label=\"Move down\" data-dir=\"0,1\">↓</button><button aria-label=\"Move right\" data-dir=\"1,0\">→</button></div></div>\n<div class=\"legend\">Dots +10 · Large dots +50 · Ghosts +200</div>\n</div>\n";
const root=board.querySelector('#chomp-game'), $=s=>root.querySelector(s), canvas=$('canvas'),ctx=canvas.getContext('2d');
if(!ctx){board.textContent='This game needs a browser with canvas support.';return ()=>{}}
const rows=['###################','#o.......#.......o#','#.##.###.#.###.##.#','#.................#','#.##.#.#####.#.##.#','#....#...#...#....#','####.###.#.###.####','#.................#','#.##.#.#####.#.##.#','#....#...#...#....#','#.######.#.######.#','#o...............o#','###################'];
const words=vocabulary.map(row=>[row.term,row.definition]);
const settings={charge:8};let reviewTime=0,score=0,ghostsEaten=0,bonusTime=0,dots,initial,player,ghosts,dir,next,energy,power,lives,mode,queue,question,qCount,attempts,correct,missed,failed,frameTime=0,moveClock=0,ghostClock=0,invulnerable=0;
const key=(x,y)=>x+','+y, walk=(x,y)=>rows[y]?.[x]!==undefined&&rows[y][x]!=='#';
function shuffle(a){for(let i=a.length-1;i>0;i--){let j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function reset(){reviewTime=0;score=0;ghostsEaten=0;bonusTime=0;$('#cc-bonus').textContent='';dots=new Map;rows.forEach((r,y)=>[...r].forEach((c,x)=>{if(c!== '#')dots.set(key(x,y),c==='o')}));player={x:9,y:11};dots.delete(key(9,11));initial=dots.size;ghosts=[{x:8,y:3,home:[8,3]},{x:10,y:7,home:[10,7]}];dir=[0,0];next=[0,0];energy=0;power=0;lives=3;queue=words.map((_,i)=>i);qCount=0;attempts=0;correct=0;missed=new Set;invulnerable=0;ask();draw()}
function hud(){ $('#cc-score').textContent=score;$('.power-status').setAttribute('data-active',power>0);$('#cc-power').textContent=power>0?'⚡ CHASE GHOSTS · '+power.toFixed(1)+'s'+(mode==='play'?'':' · paused'):'⚡ Find a large dot to chase ghosts'; $('#cc-dots').textContent=(initial-dots.size)+' / '+initial;$('#cc-lives').textContent=lives;$('#cc-accuracy').textContent=attempts?correct+' / '+attempts:'—';$('#cc-seconds').textContent=Math.ceil(energy)+' / '+settings.charge+'s';$('.fill').style.width=(energy/settings.charge*100)+'%';$('.track').setAttribute('aria-valuenow',Math.round(energy/settings.charge*100));$('#cc-pause').disabled=!['play','pause'].includes(mode);$('#cc-pause').textContent=mode==='pause'?'Resume':'Pause';$('#cc-status').textContent=mode==='play'?(power>0?'Power pellet! Chase the ghosts':'Collect dots · next question when energy runs out'):mode==='pause'?'Game paused':mode==='end'?'Round complete':qCount===1?'Answer to Enter Maze':'Maze paused · take your time';}
function ask(){$('.wrong-mark').hidden=true;$('.dialog').setAttribute('data-review','false');mode='question';energy=0;question=queue.shift();queue.push(question);qCount++;failed=false;$('.shade').hidden=false;$('.word').hidden=false;$('.choices').hidden=false;$('.recap').hidden=true;$('#cc-continue').hidden=true;$('#cc-tag').textContent=qCount===1?'Answer to Enter Maze':'CHARGE '+String(qCount).padStart(2,'0')+' · MAZE PAUSED';$('#cc-prompt').textContent='';$('#cc-prompt').hidden=true;$('.word').textContent=words[question][0];$('.feedback').textContent='';$('.choices').replaceChildren();const answers=shuffle([words[question][1],...shuffle(vocabulary[question].answers.slice()).slice(0,3)]);answers.forEach(answer=>{const b=document.createElement('button');b.textContent=answer;b.onclick=()=>{if(mode!=='question')return;if(!failed){attempts++;if(answer===words[question][1])correct++;}if(answer!==words[question][1]){if(!failed){missed.add(question);queue.splice(2,0,question)}failed=true;mode='review';reviewTime=2;$('.choices').hidden=true;$('.wrong-mark').hidden=false;$('.dialog').setAttribute('data-review','true');$('#cc-tag').textContent='';$('.feedback').textContent='Correct Answer is: '+words[question][1];hud();return;}else{energy=settings.charge;mode='play';$('.shade').hidden=true;moveClock=0;ghostClock=0;hud();$('#cc-pause').focus();}hud()};b.dir='auto';$('.choices').append(b)});hud()}
$('#cc-continue').onclick=()=>{if(mode==='end'){reset();return}mode='play';$('.shade').hidden=true;moveClock=0;ghostClock=0;hud();$('#cc-pause').focus()};
function pause(){if(mode==='play'){mode='pause';$('.shade').hidden=false;$('#cc-tag').textContent='TAKE A BREATHER';$('#cc-prompt').hidden=false;$('#cc-prompt').textContent='Maze paused';$('.word').hidden=true;$('.choices').hidden=true;$('.feedback').textContent='Your energy and ghosts are paused.';$('#cc-continue').textContent='Resume playing →';$('#cc-continue').hidden=false;}else if(mode==='pause'){mode='play';$('.shade').hidden=true}hud()}
$('#cc-pause').onclick=pause;const onVisibility=()=>{if(document.hidden&&mode==='play')pause()};document.addEventListener('visibilitychange',onVisibility);
const directions={ArrowLeft:[-1,0],a:[-1,0],ArrowRight:[1,0],d:[1,0],ArrowUp:[0,-1],w:[0,-1],ArrowDown:[0,1],s:[0,1]};
root.addEventListener('keydown',e=>{if(mode==='play'&&directions[e.key]){e.preventDefault();next=directions[e.key]}});root.querySelectorAll('[data-dir]').forEach(b=>b.onclick=()=>{next=b.dataset.dir.split(',').map(Number)});
function end(won){mode='end';$('.shade').hidden=false;$('#cc-tag').textContent=won?'MAZE COMPLETE':'ROUND COMPLETE';$('#cc-prompt').hidden=false;$('#cc-prompt').textContent=won?'🎉 Every dot collected!':'🌟 Ready for another run?';$('.word').hidden=true;$('.choices').hidden=true;$('.feedback').textContent='Vocabulary · '+correct+' of '+attempts+' correct on the first try';$('.recap').hidden=false;$('.recap').textContent='Score: '+score+' · Ghosts eaten: '+ghostsEaten+'\nDots collected: '+(initial-dots.size)+' / '+initial+(missed.size?'\nWords to revisit: '+[...missed].map(i=>words[i][0]+' = '+words[i][1]).join(' · '):'\nNo missed words this round.');$('#cc-continue').textContent='Play again';$('#cc-continue').hidden=false;hud()}
function collision(){if(invulnerable>0)return;for(const g of ghosts){if(g.x===player.x&&g.y===player.y){if(power>0){score+=200;ghostsEaten++;bonusTime=1.8;$('#cc-bonus').textContent='👻 +200!';[g.x,g.y]=g.home;invulnerable=.4;hud()}else{lives--;if(!lives){end(false);return}player={x:9,y:11};dir=[0,0];next=[0,0];ghosts.forEach(g=>[g.x,g.y]=g.home);invulnerable=2;ask();$('.feedback').textContent='A ghost caught you. Your dots are safe! Answer to recharge.';return}}}}
function step(dt){if(mode==='review'){if(document.hidden)return;reviewTime=Math.max(0,reviewTime-dt);if(reviewTime<=0){energy=settings.charge;mode='play';$('.shade').hidden=true;$('.wrong-mark').hidden=true;$('.dialog').setAttribute('data-review','false');moveClock=0;ghostClock=0;hud();$('#cc-pause').focus()}return}if(mode!=='play')return;bonusTime=Math.max(0,bonusTime-dt);if(!bonusTime)$('#cc-bonus').textContent='';energy=Math.max(0,energy-dt);power=Math.max(0,power-dt);invulnerable=Math.max(0,invulnerable-dt);if(energy===0){ask();return}moveClock+=dt;ghostClock+=dt;if(moveClock>=.26){moveClock%=.26;if(walk(player.x+next[0],player.y+next[1]))dir=next;if(walk(player.x+dir[0],player.y+dir[1])){player.x+=dir[0];player.y+=dir[1]}let k=key(player.x,player.y);if(dots.has(k)){if(dots.get(k)){power=5;score+=50}else{score+=10}dots.delete(k)}if(!dots.size){end(true);return}collision();if(mode!=='play')return}if(ghostClock>=.52){ghostClock%=.52;ghosts.forEach(g=>{let options=shuffle([[1,0],[-1,0],[0,1],[0,-1]].filter(([x,y])=>walk(g.x+x,g.y+y)));if(Math.random()<.65)options.sort((a,b)=>{const dist=d=>Math.abs(g.x+d[0]-player.x)+Math.abs(g.y+d[1]-player.y);return (dist(a)-dist(b))*(power>0?-1:1)});g.x+=options[0][0];g.y+=options[0][1]});collision()}hud()}
function draw(){const cs=getComputedStyle(root),color=n=>cs.getPropertyValue(n).trim();/* Resolve light-dark colors through an element before canvas use. */const probe=document.createElement('span');root.append(probe);const resolve=n=>{probe.style.color=color(n);return getComputedStyle(probe).color};const wall=resolve('--cc-wall'),dot=resolve('--cc-dot'),yellow=resolve('--cc-yellow'),blue=resolve('--cc-blue'),bg=resolve('--cc-panel'),pink=resolve('--cc-pink'),teal=resolve('--cc-teal'),orange=resolve('--cc-orange');probe.remove();ctx.clearRect(0,0,570,390);rows.forEach((r,y)=>[...r].forEach((c,x)=>{if(c==='#'){ctx.fillStyle=[wall,teal,blue][Math.floor(y/4)%3];ctx.beginPath();ctx.roundRect(x*30+3,y*30+3,24,24,6);ctx.fill()}}));dots.forEach((big,k)=>{const[x,y]=k.split(',').map(Number);ctx.fillStyle=big?yellow:[pink,orange,teal][(x+y)%3];ctx.beginPath();ctx.arc(x*30+15,y*30+15,big?6:2.4,0,Math.PI*2);ctx.fill()});const angle=dir[0]<0?Math.PI:dir[1]<0?-Math.PI/2:dir[1]>0?Math.PI/2:0;ctx.save();if(power>0){ctx.shadowColor=yellow;ctx.shadowBlur=20;ctx.strokeStyle=yellow;ctx.lineWidth=3;ctx.beginPath();ctx.arc(player.x*30+15,player.y*30+15,14,0,Math.PI*2);ctx.stroke()}ctx.fillStyle=yellow;ctx.beginPath();ctx.moveTo(player.x*30+15,player.y*30+15);ctx.arc(player.x*30+15,player.y*30+15,11,angle+.35,angle+Math.PI*2-.35);ctx.closePath();ctx.fill();ctx.restore();if(invulnerable>0){ctx.strokeStyle=blue;ctx.lineWidth=2;ctx.beginPath();ctx.arc(player.x*30+15,player.y*30+15,14,0,Math.PI*2);ctx.stroke()}ghosts.forEach((g,i)=>{let x=g.x*30+15,y=g.y*30+15;ctx.fillStyle=power>0?blue:[pink,teal][i%2];ctx.beginPath();ctx.arc(x,y-2,10,Math.PI,0);ctx.lineTo(x+10,y+10);ctx.lineTo(x+5,y+6);ctx.lineTo(x,y+10);ctx.lineTo(x-5,y+6);ctx.lineTo(x-10,y+10);ctx.closePath();ctx.fill();ctx.fillStyle=bg;ctx.beginPath();ctx.arc(x-4,y-2,3,0,7);ctx.arc(x+4,y-2,3,0,7);ctx.fill();ctx.fillStyle=wall;ctx.fillRect(x-4,y-3,2,3);ctx.fillRect(x+4,y-3,2,3)})}
let stopped=false,frame;reset();let renderClock=0;function tick(t){if(stopped||!root.isConnected)return;const dt=Math.min((t-frameTime)/1000,.1);frameTime=t;step(dt);renderClock+=dt;if(renderClock>.07){draw();renderClock=0}frame=requestAnimationFrame(tick)}frame=requestAnimationFrame(tick);

return ()=>{stopped=true;cancelAnimationFrame(frame);document.removeEventListener('visibilitychange',onVisibility)};
    }

    // Serialized into downloaded HTML so all games also work offline.
    function mountGames(groups, mountAsteroids, createAsteroids, mountChomp) {
        const doc = document, byId = id => doc.getElementById(id);
        const dialog = byId('gamesDialog'), board = byId('gameBoard'), feedback = byId('gameFeedback');
        const title = byId('gameTitle'), progress = byId('gameProgress'), next = byId('gameNext');
        const language = byId('gameLanguage');
        const shuffle = values => {
            const result = values.slice();
            for (let i = result.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [result[i], result[j]] = [result[j], result[i]];
            }
            return result;
        };
        let mode = '', rows = [], offset = 0, score = 0, attempts = 0, selected = null, matched = new Set(), drag = null;
        let stopAsteroids = null, matchingCount = 0, cardRound = 1;
        let matchingRunId='',totalTerms=0, mastered=new Set(), pending=new Set(), locked=false, timer=null, startedAt=0, finishedMs=0, runToken=0;
        function later(callback,ms){const token=runToken;const id=setTimeout(()=>{pending.delete(id);if(token===runToken)callback();},ms);pending.add(id);}
        function stopPending(){runToken++;pending.forEach(clearTimeout);pending.clear();clearInterval(timer);timer=null;locked=false;doc.getElementById('gameMistake')?.remove();}
        function mistake(text='Try again'){
            doc.getElementById('gameMistake')?.remove();
            const overlay=element('div',undefined,'game-mistake');overlay.id='gameMistake';overlay.setAttribute('role','alert');
            overlay.append(element('span','×'),element('strong',text));dialog.append(overlay);locked=true;
            later(()=>{overlay.remove();locked=false;},800);
        }

        const labels = { quiz: 'Multiple Choice', lines: 'Connect the Words', cards: 'Match the Cards', asteroids: 'Vocabulary Asteroids', chomp: 'Chomp & Charge' };
        function element(tag, text, className) {
            const node = doc.createElement(tag);
            if (text !== undefined) node.textContent = text;
            if (className) node.className = className;
            return node;
        }
        function button(text, action, className) {
            const node = element('button', text, className);
            node.type = 'button'; node.dir = 'auto'; node.onclick = action;
            return node;
        }
        function message(text) { feedback.textContent = text; }
        function clearSelection() {
            if (selected) { selected.node.classList.remove('selected'); selected.node.setAttribute('aria-pressed', 'false'); }
            selected = null;
        }
        function summary() {
            clearInterval(timer);timer=null;
            board.replaceChildren(element('h3', 'Well done! Practice complete.'));
            if(mode==='cards'){board.append(element('p',`Time: ${(finishedMs/1000).toFixed(1)} seconds`));submitMatching();}
            progress.textContent = mode === 'quiz' ? `${mastered.size} of ${totalTerms} terms mastered · ${attempts} attempts` : `${rows.length} pairs matched in ${attempts} attempts`;
            message('Choose Play again for a fresh shuffle, or choose another game.');
            next.hidden = true;
        }
        function submitMatching(){
            const config=doc.getElementById('peninaClassConfig'),url=config?JSON.parse(config.textContent).matchingUrl:'';
            if(!url||window.location.protocol==='file:'){board.append(element('p','Play a published set from your class page to submit a time.'));return;}
            const form=element('form'),label=element('label','Your initials (1–3 letters) '),input=element('input');
            input.maxLength=3;input.required=true;input.pattern='[A-Za-z]{1,3}';input.setAttribute('aria-label','Your initials');label.append(input);
            const submit=element('button','Submit time');submit.type='submit';const status=element('p');status.setAttribute('role','status');form.append(label,submit);board.append(form,status);
            const result={milliseconds:finishedMs,language:language.value,matched:rows.length,runId:matchingRunId},token=runToken;
            form.onsubmit=async event=>{event.preventDefault();if(submit.disabled||!form.reportValidity())return;submit.disabled=true;status.textContent='Saving…';
                try{const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...result,initials:input.value.toUpperCase()})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not save your time.');if(token!==runToken)return;form.remove();status.textContent='Time saved! Your time will appear in the pre-game top three if it qualifies.';}
                catch(error){if(token!==runToken)return;submit.disabled=false;status.textContent=error.message;}
            };
        }
        function updateProgress() {
            progress.textContent = mode === 'quiz' ? `${mastered.size} of ${totalTerms} terms mastered · ${attempts} attempts` : `${Math.min(rows.length,offset + matched.size)} of ${rows.length} pairs matched · ${attempts} attempts`+(mode==='cards'?` · Round ${cardRound} of 2 · ${((finishedMs||performance.now()-startedAt)/1000).toFixed(1)} seconds`:'');
        }
        function quiz() {
            const row = rows[offset];
            board.append(element('h3', row.term, 'game-term'));
            const choices = element('div', undefined, 'game-options');
            let answered = false, tries=0;
            shuffle([row.definition, ...row.answers]).forEach(answer => {
                const node = button(answer, () => {
                    if (answered || locked || node.disabled) return;
                    tries++; attempts++;
                    const correct = answer === row.definition;
                    if(!correct){
                        node.disabled=true;node.classList.add('incorrect');
                        if(tries===1){mistake();message('Try again — one more chance.');updateProgress();return;}
                        answered=true;rows.splice(Math.min(rows.length,offset+3),0,row);
                        choices.querySelectorAll('button').forEach(choice=>{choice.disabled=true;if(choice.textContent===row.definition)choice.classList.add('matched');});
                        mistake('We’ll practice this one again');message('The correct definition is: '+row.definition+'. This term will return later.');
                        updateProgress();later(()=>{offset++;render();},1400);return;
                    }
                    answered=true;mastered.add(row.id);score++;
                    choices.querySelectorAll('button').forEach(choice=>{choice.disabled=true;if(choice.textContent===row.definition)choice.classList.add('matched');});
                    message('Correct! Great work.');updateProgress();later(()=>{offset++;render();},800);
                }, 'game-tile');
                choices.append(node);
            });
            board.append(choices);

        }

        function match(first, second) {
            if (locked || first.node.disabled || second.node.disabled || first.side === second.side) return;
            attempts++;
            // Identical definitions are interchangeable, including repeated vocabulary terms.
            if (first.row.definition === second.row.definition) {
                const term = first.side === 'term' ? first : second;
                matched.add(term.row.id);
                [first.node, second.node].forEach(node => { node.disabled = true; node.classList.add('matched'); node.setAttribute('aria-pressed', 'false'); });
                if (mode === 'lines') {
                    const link = element('div', undefined, 'game-link');
                    board.querySelector('.game-lines').append(link);
                    link._ends = [first.node, second.node];
                    drawLines();
                }
                if(mode==='cards')[first.node,second.node].forEach(node=>{node.classList.add('popping');later(()=>{node.classList.add('popped');node.setAttribute('aria-hidden','true');},320);});
                message('Correct match!');
            } else {mistake();message('✕ Try again — those do not match.');}
            clearSelection(); updateProgress();
            if (matched.size === matchingCount) {
                board.querySelectorAll('.game-tile').forEach(node => {node.disabled=true;}); message('All terms matched! The extra definitions were distractors.'); if(mode==='cards'){if(cardRound===2&&offset+matchingCount===rows.length)finishedMs=Math.max(1,Math.round(performance.now()-startedAt));later(()=>{offset+=matchingCount;render();},450);}else{next.hidden = false; next.focus();}
            }
        }
        function choose(item) {
            if (locked || item.node.disabled) return;
            if (selected?.node === item.node) { clearSelection(); return; }
            if (selected && selected.side !== item.side) { match(selected, item); return; }
            clearSelection(); selected = item;
            item.node.classList.add('selected'); item.node.setAttribute('aria-pressed', 'true');
            message(item.side === 'term' ? 'Now choose its definition.' : 'Now choose its term.');
        }
        function drawLine(line, a, b) {
            const box = board.getBoundingClientRect();
            const x = a.x - box.left, y = a.y - box.top;
            line.style.left = `${x}px`; line.style.top = `${y}px`;
            line.style.width = `${Math.hypot(b.x - a.x, b.y - a.y)}px`;
            line.style.transform = `rotate(${Math.atan2(b.y - a.y, b.x - a.x)}rad)`;
        }
        function center(node) {
            const box = node.querySelector('.game-dot').getBoundingClientRect();
            return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
        }
        function drawLines() {
            board.querySelectorAll('.game-link').forEach(link => {
                if (link._ends) drawLine(link, center(link._ends[0]), center(link._ends[1]));
            });
        }
        if (typeof ResizeObserver !== 'undefined') new ResizeObserver(drawLines).observe(board);
        window.addEventListener('resize', drawLines);
        function matching() {
            let group = rows.slice(offset, offset + 6);
            const items = [];
            const key = text => text.normalize('NFKC').toLowerCase().replace(/[\u0591-\u05c7]/g, '').replace(/[^\p{L}\p{N}]/gu, '');
            function distractors() {
                const used = new Set(group.map(row => key(row.definition)));
                return shuffle(group.flatMap(row => row.answers)).filter(definition => {
                    const value=key(definition);
                    if(used.has(value))return false;
                    used.add(value);return true;
                }).slice(0,3).map((definition,i)=>({id:'extra-'+i,definition}));
            }
            let extras = distractors();
            // Reserve three decoys even when all saved alternatives belong to this vocabulary set.
            while(extras.length<3 && group.length>1){group=group.slice(0,-1);extras=distractors();}
            matchingCount = group.length;
            const makeTile = (row, side) => {
                const item = { row, side };
                item.node = button(side === 'term' ? row.term : row.definition, () => choose(item), `game-tile game-${side}`);
                item.node.setAttribute('aria-label', `${side === 'term' ? 'Term' : 'Definition'}: ${item.node.textContent}`);
                item.node.setAttribute('aria-pressed', 'false');
                if (mode === 'lines') {
                    const dot = element('span', undefined, 'game-dot');
                    dot.setAttribute('aria-hidden', 'true'); item.node.append(dot);
                }
                items.push(item); return item.node;
            };
            if (mode === 'cards') {
                const grid = element('div', undefined, 'game-card-grid');
                shuffle([...group.flatMap(row => [makeTile(row, 'term'), makeTile(row, 'definition')]), ...extras.map(row=>makeTile(row,'definition'))]).forEach(node => grid.append(node));
                board.append(grid);
            } else {
                const columns = element('div', undefined, 'game-columns');
                ['term', 'definition'].forEach(side => {
                    const column = element('div', undefined, 'game-column');
                    column.append(element('h3', side === 'term' ? 'Terms' : 'Definitions'));
                    shuffle(side==='term'?group:[...group,...extras]).forEach(row => column.append(makeTile(row, side)));
                    columns.append(column);
                });
                board.append(element('div', undefined, 'game-lines'), columns);
                items.forEach(item => {
                    item.node.onpointerdown = event => {
                        if (locked || item.node.disabled || event.button !== 0 || !event.target.closest('.game-dot')) return;
                        drag = { item, start: { x: event.clientX, y: event.clientY }, moved: false, line: element('div', undefined, 'game-link dragging') };
                        board.querySelector('.game-lines').append(drag.line);
                        item.node.setPointerCapture(event.pointerId);
                    };
                    item.node.onpointermove = event => {
                        if (!drag || drag.item !== item) return;
                        const end = { x: event.clientX, y: event.clientY };
                        if (Math.hypot(end.x - drag.start.x, end.y - drag.start.y) > 6) { drag.moved = true; clearSelection(); }
                        drawLine(drag.line, center(item.node), end);
                    };
                    item.node.onpointerup = event => {
                        if (!drag) return;
                        const moved = drag.moved;
                        drag.line.remove(); drag = null;
                        if (!moved) return;
                        const target = doc.elementFromPoint(event.clientX, event.clientY);
                        const other = items.find(candidate => candidate.node === target?.closest('.game-tile'));
                        if (other && !other.node.disabled && other.side !== item.side) match(item, other);
                        else message('Drag from the dot on a term to the dot on its definition in the other column.');
                        // Suppress the click synthesized after a drag, but keep keyboard clicks.
                        item.node.onclick = () => {};
                        setTimeout(() => { item.node.onclick = () => choose(item); }, 0);
                    };
                    item.node.onpointercancel = () => { drag?.line.remove(); drag = null; };
                });
            }
            next.textContent = offset + group.length === rows.length ? 'See results' : 'Next round';
            next.onclick = () => { offset += group.length; render(); };
        }
        function render() {
            clearSelection(); matched = new Set(); drag = null;
            board.replaceChildren(); message(''); next.hidden = true;
            if (offset >= rows.length && mode === 'cards' && cardRound === 1) { cardRound = 2; offset = 0; rows = shuffle(rows); }
            if (offset >= rows.length) { summary(); return; }
            updateProgress(); mode === 'quiz' ? quiz() : matching();
            title.focus();
        }
        async function prepare(value) {
            stopPending();stopAsteroids?.();stopAsteroids=null;clearSelection();mode=value;
            byId('gameBack').hidden=false;
            byId('gameMenu').hidden=true;byId('gamePlay').hidden=true;byId('gameLobby').hidden=false;
            const heading=byId('lobbyTitle'),scores=byId('lobbyScores'),note=byId('lobbyNote');
            byId('lobbyHelp').textContent=value==='cards'?'There are 2 rounds. Click on a term, then click on its definition. Match every term in each round.':value==='asteroids'?'There are 3 rounds: asteroids, pursuing Martians, then enemy ships.':value==='chomp'?'Clear the maze, dodge ghosts, and power up with your vocabulary.':'';
            heading.textContent=labels[value];scores.replaceChildren();
            const ranked=value==='cards'||value==='asteroids';
            byId('lobbyRankingTitle').hidden=!ranked;
            note.textContent=ranked?'Loading top three…':'Ready to practice?';
            const launch=byId('gameLaunch'),token=runToken;
            launch.onclick=()=>{if(token!==runToken)return;byId('gameLobby').hidden=true;start(value);};
            heading.focus();
            if(!ranked)return;
            const config=doc.getElementById('peninaClassConfig');
            const settings=config?JSON.parse(config.textContent):{};
            const url=value==='cards'?settings.matchingUrl:settings.leaderboardUrl;
            if(!url||window.location.protocol==='file:'){note.textContent='Class records are available when you open a published set online.';return;}
            try{
                const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw new Error();
                const data=await response.json();if(token!==runToken)return;
                const set=new URL(url,window.location.href).searchParams.get('set');
                const entries=value==='cards'?(data.boards.find(group=>group.pathname===set&&group.language===language.value)?.scores||[]):data.scores;
                entries.slice(0,3).forEach(entry=>scores.append(element('li',entry.initials+' — '+(value==='cards'?(entry.milliseconds/1000).toFixed(2)+' seconds':entry.score.toLocaleString()+' points'))));
                note.textContent=entries.length?(value==='cards'?'Fastest times for this set. The timer starts when you press Launch.':'Highest scores in your class.'):'No scores yet.';
            }catch(_error){if(token===runToken)note.textContent='Scores are temporarily unavailable. You can still launch the game.';}
        }
        function start(value) {
            stopPending();stopAsteroids?.(); stopAsteroids = null;
            matchingRunId=typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
            mastered=new Set();startedAt=performance.now();finishedMs=0;totalTerms=groups[language.value].length;
            cardRound = 1; mode = value; rows = shuffle(groups[language.value]); offset = score = attempts = 0;
            byId('gameMenu').hidden = true; byId('gamePlay').hidden = false;
            title.textContent = labels[mode];
            if (mode === 'chomp') {
                next.hidden = true; message(''); progress.textContent = '';
                byId('gameHelp').textContent = '';
                stopAsteroids = mountChomp({ board, rows });
                return;
            }
            if (mode === 'asteroids') {
                board.replaceChildren(); next.hidden = true; message('');
                byId('gameHelp').textContent = 'Earn 10 fuel cells for every correct answer. There are 3 rounds: asteroids, pursuing Martians, then enemy ships. Hits cost 150 points; wrong answers cost 25. Zero points means game over.';
                stopAsteroids = mountAsteroids({ board, rows, createEngine: createAsteroids, setFeedback: message, setProgress: text => { if (progress.textContent !== text) progress.textContent = text; } });
                return;
            }
            byId('gameHelp').textContent = mode === 'quiz' ? 'You have two chances. Miss twice and the term returns later.' : mode === 'lines'
                ? 'Match every term; extra definitions will remain unused. Drag from the dot inside a term oval to the dot inside its definition oval. You can also click or use Tab and Enter to select each pair.'
                : 'There are 2 rounds. Click on a term, then click on its definition. Match every term in each round; correct pairs pop away. Extra definitions will remain unused. Race the clock!';
            if(mode==='cards')timer=setInterval(updateProgress,100);
            render();
        }
        function menu() {
            stopAsteroids?.(); stopAsteroids = null;
            stopPending();mode = ''; clearSelection(); board.replaceChildren(); drag = null;
            byId('gameBack').hidden = true;
            byId('gameMenu').hidden = false; byId('gamePlay').hidden = true;byId('gameLobby').hidden=true;
            byId('gameMenu').querySelector('button').focus();
        }
        Object.keys(groups).forEach(value => {
            const option = element('option', `${value === 'english' ? 'English' : 'Hebrew'} (${groups[value].length} terms)`);
            option.value = value; language.append(option);
        });
        dialog.querySelectorAll('[data-game]').forEach(node => { node.onclick = () => prepare(node.dataset.game); });
        byId('gameAgain').onclick = () => prepare(mode);
        byId('gameBack').onclick = menu;
        byId('gameClose').onclick = () => dialog.close();
        byId('gamify').onclick = () => { menu(); dialog.showModal(); };
        dialog.addEventListener('close', () => { menu(); byId('gamify').focus(); });
        if (window.location.hash === '#gamify') byId('gamify').click();
    }

    function gamesMarkup(groups) {
        if (!Object.keys(groups).length) return '';
        return `<style>
.gamify-button{display:block;width:100%;margin-top:14px;padding:14px;border:0;border-radius:16px;background:#7024b5;color:#ffec55;font-size:25px;font-weight:950;letter-spacing:1px;text-shadow:1px 2px #421570;cursor:pointer}.gamify-button:hover{background:#591a93}.games-dialog{width:min(960px,95vw);max-height:92vh;overflow:auto;border:0;border-radius:24px;padding:24px;background:#faf7ff;color:#241632}.games-dialog::backdrop{background:#201030b8}.games-dialog button{min-height:44px;cursor:pointer}.games-dialog button:focus-visible,.games-dialog select:focus-visible{outline:3px solid #7024b5;outline-offset:3px}.games-dialog [hidden]{display:none!important}.games-heading,.game-footer{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.games-heading{align-items:flex-start}.games-brand{display:grid;justify-items:start;gap:10px}.games-heading h2{margin:0;color:#7024b5}.game-menu-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:24px}.game-menu-options button{padding:22px;font-size:20px;border-color:#cab5e0}.games-dialog select{padding:10px;max-width:100%;font:inherit}.game-board{position:relative;margin:20px 0}.game-term{text-align:center;font-size:32px}.game-options{display:grid;gap:12px}.game-tile{overflow-wrap:anywhere;white-space:normal;font-size:19px;padding:16px;border:2px solid #c9b6dd;background:white;color:#241632}.game-tile.selected{border-color:#7024b5;box-shadow:0 0 0 3px #dfc5f8}.game-tile.matched{background:#dcf6e3;border-color:#21823b;color:#164f26;opacity:1}.game-tile.incorrect{background:#ffe1dc;border-color:#b43d2b;opacity:1}.game-card-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.game-card-grid .game-tile{min-height:115px}.game-term.game-tile{font-size:23px}.game-columns{display:grid;grid-template-columns:1fr 1fr;gap:60px;position:relative}.game-column{display:grid;gap:12px;align-content:start;min-width:0}.game-column h3{text-align:center}.game-column .game-tile{position:relative;touch-action:none;user-select:none;min-height:70px;border-radius:999px;padding:16px 38px}.game-dot{position:absolute;top:50%;transform:translateY(-50%);width:18px;height:18px;border-radius:50%;background:#7024b5;box-shadow:0 0 0 5px #7024b51a;cursor:crosshair}.game-term .game-dot{right:10px}.game-definition .game-dot{left:10px}.game-lines{position:absolute;inset:0;pointer-events:none}.game-link{z-index:1;position:absolute;height:4px;background:#21823b;transform-origin:0 50%;border-radius:4px}.game-link.dragging{background:#7024b5;z-index:2}.game-feedback{min-height:28px;font-weight:800}.game-footer{margin-top:20px}@media(max-width:540px){.games-dialog{padding:16px}.game-card-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.game-columns{gap:24px}.game-tile{padding:10px;font-size:16px}}@media print{.games-dialog,.gamify-button{display:none!important}}
.game-lobby{max-width:480px;margin:24px auto;text-align:center}.game-lobby ol{padding:0;list-style-position:inside}.game-lobby li{padding:12px;border-bottom:1px solid #e2d7ed;font-size:20px;font-weight:750}.game-lobby p{color:#675772;line-height:1.5}.game-launch{display:block;width:100%;margin-top:22px;background:#7024b5;color:#fff;font-size:22px;font-weight:850}.game-mistake{position:fixed;inset:0;z-index:100;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#fff3f0e8;color:#c52638;pointer-events:auto;text-align:center}.game-mistake span{font-size:min(55vh,300px);line-height:.9;font-weight:900}.game-mistake strong{font-size:clamp(24px,5vw,44px)}@keyframes card-pop{35%{transform:scale(1.12);background:#b0f2c9}100%{transform:scale(.1);opacity:0}}.game-tile.popping{animation:card-pop .32s ease-out forwards;pointer-events:none}.game-tile.popped{visibility:hidden;pointer-events:none}@media(prefers-reduced-motion:reduce){.game-tile.popping{animation:none;opacity:0}}.game-menu-intro{font-size:20px;color:#514169}.game-menu-options button{display:flex;flex-direction:column;align-items:flex-start;text-align:left;gap:10px;min-height:170px;padding:24px!important;background:linear-gradient(135deg,#f2e7ff,#e5f5ff);border:2px solid #cbb4ef;box-shadow:0 8px 20px #39225714}.game-menu-options button:nth-child(2){background:linear-gradient(135deg,#dcfaf1,#e5f5ff)}.game-menu-options button:nth-child(3){background:linear-gradient(135deg,#fff0d7,#ffe6ed)}.game-menu-options button:nth-child(4){background:linear-gradient(135deg,#291447,#243d79);color:white}.game-menu-options strong{font-size:22px}.game-menu-options small{font-size:14px;line-height:1.5}.game-icon{font-size:34px}.asteroids-hud{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:12px 16px;background:#26163e;color:#fff;border-radius:16px 16px 0 0}.asteroids-hud b{font-size:23px;color:#ffec55;margin-left:5px}.asteroids-hud button{background:#fff;color:#26163e}.asteroids-arena{position:relative;background:#0c1026;border-radius:0 0 16px 16px;overflow:hidden}.asteroids-arena canvas{display:block;width:100%;height:auto;min-height:250px;object-fit:contain;outline-offset:-4px}.asteroids-arena canvas:focus-visible{outline:3px solid #ffec55}.asteroids-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;background:#0c1026d9;overflow:auto}.asteroids-question{width:min(100%,600px);max-height:100%;overflow:auto;padding:20px;border:1px solid #a089d0;border-radius:18px;background:#faf7ff;color:#241632}.asteroids-question h3{margin:0;font-size:22px}.asteroids-question p{margin:12px 0}.asteroids-question .asteroids-term{font-size:30px;font-weight:850;text-align:center}.asteroids-options{display:grid;grid-template-columns:1fr 1fr;gap:8px}.asteroids-options button{white-space:normal;overflow-wrap:anywhere;padding:10px;font-size:16px;min-height:44px}.asteroids-options button.correct{background:#dcf6e3;border-color:#21823b;color:#164f26;opacity:1}.asteroids-options button.wrong{background:#ffe1dc;border-color:#b43d2b;color:#792519;opacity:1}.asteroids-result{font-weight:800;overflow-wrap:anywhere}.asteroids-continue{background:#7024b5;color:#ffec55;width:100%;font-weight:850}.asteroids-controls{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px}.asteroids-controls button{touch-action:none;user-select:none;background:#eee4fc;color:#351454;font-size:16px;padding:12px 4px}.asteroids-controls button[data-flight=fire]{background:#7024b5;color:#ffec55}.asteroids-rules{font-size:13px;line-height:1.7;color:#5e526f}@media(max-width:540px){.game-menu-options{grid-template-columns:1fr}.asteroids-arena canvas{min-height:240px}.asteroids-overlay{position:relative;padding:10px}.asteroids-overlay[hidden]{display:none!important}.asteroids-arena:has(.asteroids-overlay:not([hidden])) canvas{display:none}.asteroids-question{padding:16px}.asteroids-options{grid-template-columns:1fr}.asteroids-controls button{font-size:13px}.asteroids-hud{padding:10px;font-size:13px}.asteroids-hud b{font-size:20px}}
</style>
<dialog id="gamesDialog" class="games-dialog" aria-labelledby="gamesTitle"><div class="games-heading"><div class="games-brand"><h2 id="gamesTitle">Gamify!</h2><button id="gameBack" type="button" hidden>Choose another game</button></div><button id="gameClose" type="button">Close</button></div><section id="gameMenu"><p class="game-menu-intro">Choose your challenge. Build your skills. Beat your best.</p><label>Answer language <select id="gameLanguage"></select></label><div class="game-menu-options"><button type="button" data-game="quiz"><span class="game-icon">⚡</span><strong>Quick Quiz</strong><small>Trust your knowledge. Find the right definition.</small></button><button type="button" data-game="lines"><span class="game-icon">🔗</span><strong>Connect the Words</strong><small>Draw the connections. Outsmart the distractors.</small></button><button type="button" data-game="cards"><span class="game-icon">🧩</span><strong>Match the Cards</strong><small>Find every pair. Leave the decoys behind.</small></button><button type="button" data-game="asteroids"><span class="game-icon">🚀</span><strong>Vocabulary Asteroids</strong><small>Fuel up. Survive three rounds. Become captain.</small></button><button type="button" data-game="chomp"><span class="game-icon">👻</span><strong>Chomp &amp; Charge</strong><small>Chomp the dots. Chase the ghosts. Power up with words.</small></button></div></section><section id="gameLobby" class="game-lobby" hidden><h2 id="lobbyTitle" tabindex="-1"></h2><p id="lobbyHelp"></p><h3 id="lobbyRankingTitle">Top 3</h3><ol id="lobbyScores"></ol><p id="lobbyNote" role="status"></p><button id="gameLaunch" class="game-launch" type="button">Launch</button></section><section id="gamePlay" hidden><h2 id="gameTitle" tabindex="-1"></h2><p id="gameHelp"></p><p id="gameProgress" role="status"></p><div id="gameBoard" class="game-board"></div><p id="gameFeedback" class="game-feedback" role="status" aria-live="polite"></p><button id="gameNext" type="button" hidden>Next</button><div class="game-footer"><button id="gameAgain" type="button">Play again</button></div></section></dialog>
<script>(${mountGames.toString()})(${JSON.stringify(groups).replace(/</g, '\\u003c')}, ${mountAsteroids.toString()}, ${createAsteroids.toString()}, ${mountChomp.toString()});</script>`;
    }

    function makeApp(title, cards, options = {}) {
        const groups = Object.fromEntries(['english', 'hebrew'].map(language => [language, practiceRows(cards, language)]).filter(([, rows]) => rows.length));
        const safeTitle = escapeHtml(title);
        const homeUrl = /^(https?:\/\/|\/(?!\/))/.test(options.homeUrl || '') ? options.homeUrl : '/PeninaPlus-vocab-builder/flash-cards/';
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
button{border:1px solid var(--line);background:#fff;color:var(--ink);border-radius:14px;padding:11px 12px;font-weight:750;cursor:pointer}button:hover{transform:translateY(-1px);border-color:#b7c0d3}button.primary,button.active{background:var(--accent);border-color:var(--accent);color:#fff}.language-options{display:grid;gap:8px;margin:0 0 18px;border:0;padding:0}.language-choice{display:flex;align-items:center;gap:9px;font-size:14px;font-weight:750;cursor:pointer}.language-choice input{width:18px;height:18px;margin:0;accent-color:var(--accent);cursor:pointer}.orders{display:grid;gap:9px;margin:14px 0}.actions,.controls,.ratings,.stats{display:grid;gap:9px}.actions{grid-template-columns:1fr 1fr}.controls,.ratings,.stats{grid-template-columns:repeat(3,1fr)}
.hebrew{direction:rtl;unicode-bidi:isolate;font-family:"Noto Sans Hebrew","SBL Hebrew","Arial Hebrew",Arial,sans-serif}
.topbar{display:flex;align-items:center;gap:14px;margin-bottom:18px;color:var(--muted);font-weight:700}.progress{height:10px;background:#edf0f5;border-radius:999px;overflow:hidden;flex:1}.bar{height:100%;background:var(--accent);transition:width .2s}.card-area{display:grid;place-items:center;min-height:335px}.card{width:min(100%,570px);min-height:323px;position:relative;border:1px solid var(--line);border-radius:24px;background:#fff;box-shadow:0 18px 52px rgba(21,28,43,.12);padding:32px;display:flex;flex-direction:column;justify-content:center;cursor:pointer;transition:transform .18s}.card.flipping{transform:rotateY(90deg)}.corner{position:absolute;top:18px;left:20px;color:var(--muted);font-weight:850;font-size:13px}.side{position:absolute;top:18px;right:20px;color:var(--accent);background:var(--accent2);border-radius:999px;padding:7px 11px;font-size:12px;font-weight:900}.label{color:var(--muted);font-size:13px;text-transform:uppercase;letter-spacing:.11em;font-weight:850;text-align:center;margin-bottom:12px}.main{font-size:clamp(28px,5vw,52px);line-height:1.15;text-align:center;font-weight:850}.home-link{display:inline-block;margin-bottom:16px;color:#4353ff;font-weight:750}.main:not(.card-sizing)>div+div,.definition-sizing>div+div{margin-top:18px}.card-content{display:grid}.card-content>.main{grid-area:1/1;align-self:center;min-width:0;overflow-wrap:anywhere}.card-sizing{display:grid;visibility:hidden;pointer-events:none}.card-sizing>div{grid-area:1/1;align-self:center}.term-sizing{font-size:clamp(34px,6vw,58px)}#cardContext[hidden]{display:block;visibility:hidden}.main.hebrew{font-size:clamp(34px,6vw,58px)}
.context{border:1px solid var(--line);background:#fff;border-radius:18px;margin-top:20px;padding:18px 20px;text-align:center}.context .label{text-align:left;margin-bottom:12px;font-size:11px}.context p{margin:0;line-height:1.5}.context p+p{margin-top:16px}.context p:empty{display:none}.context-he{font-size:19px}.context-he-translation{font-size:15px;color:#384152}.context-en{font-size:14px;color:#384152}.citation{display:flex;align-items:baseline;justify-content:space-between;gap:14px;direction:ltr;color:var(--muted);font-size:12px;margin-top:16px}.citation>span{min-width:0;overflow-wrap:anywhere}.citation .hebrew{text-align:right}.controls{margin-top:18px}.ratings{margin-top:10px}.know{background:#16824f;color:#fff}.almost{background:#c6a300;color:#fff}.learning{background:#c93737;color:#fff}.stats{margin-top:14px}.stat{border:1px solid var(--line);border-radius:14px;padding:10px;text-align:center}.stat b{display:block;font-size:20px}.stat span,.note{color:var(--muted);font-size:12px}.note{line-height:1.45;font-size:13px}
.print-options-dialog{width:min(92vw,560px);padding:0;border:1px solid var(--line);border-radius:22px;background:#fff;color:var(--ink);box-shadow:0 24px 80px rgba(21,28,43,.28)}.print-options-dialog::backdrop{background:rgba(21,28,43,.52);backdrop-filter:blur(3px)}.print-options-form{padding:24px}.print-options-form h2{margin:0 0 6px;font-size:26px}.print-options-intro{margin:0 0 20px;color:var(--muted);line-height:1.45}.print-option-group{display:grid;gap:10px;margin:0;padding:16px 0;border:0;border-top:1px solid var(--line)}.print-option-group legend{padding:16px 0 0;font-weight:850}.print-option-choice{display:flex;align-items:center;gap:9px;font-size:15px;font-weight:700;cursor:pointer}.print-option-choice input{width:18px;height:18px;margin:0;accent-color:var(--accent);cursor:pointer}.print-dialog-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:20px}.print-dialog-actions .primary{background:var(--accent);border-color:var(--accent);color:#fff}.print-preview{display:none;min-height:100vh;padding:24px;background:#eceae5}.print-toolbar{position:sticky;z-index:5;top:0;display:flex;max-width:8.5in;align-items:center;gap:12px;margin:0 auto 22px;padding:14px 16px;border:1px solid var(--line);border-radius:16px;background:#fff;box-shadow:var(--shadow)}.print-toolbar-copy{flex:1}.print-toolbar strong{display:block;margin-bottom:3px}.print-toolbar small{display:block;color:var(--muted);line-height:1.4}.print-toolbar button{white-space:nowrap}.print-toolbar .print-now{background:var(--accent);border-color:var(--accent);color:#fff}.sheet-caption{width:8.5in;margin:18px auto 7px;color:#555d69;font-size:13px;font-weight:850}.paper-sheet{display:grid;width:8.5in;height:11in;grid-template-columns:repeat(2,1fr);margin:0 auto 24px;padding:.25in;background:#fff;box-shadow:0 12px 38px rgba(21,28,43,.18)}.paper-sheet.six-up{grid-template-rows:repeat(3,1fr)}.paper-sheet.eight-up{grid-template-rows:repeat(4,1fr)}.paper-card{position:relative;display:flex;min-width:0;min-height:0;align-items:flex-start;justify-content:center;overflow:hidden;border:.75pt dashed #7a7a7a;padding:.16in;text-align:center}.paper-card-content{display:flex;width:100%;height:100%;flex-direction:column;align-items:center;justify-content:safe center;overflow:hidden}.paper-card-front{flex-direction:column;padding:.08in .1in .16in}.paper-card-header{display:flex;flex:none;width:100%;align-items:flex-start;justify-content:space-between;gap:.1in;direction:ltr;color:#858585;font-size:7pt;font-weight:800;line-height:1.2}.paper-card-title{min-width:0;text-align:left;overflow-wrap:anywhere}.paper-card-number{flex:none;direction:ltr;text-align:right;white-space:nowrap}.paper-card-front .paper-card-content{flex:1;min-height:0;height:auto}.paper-term{font-size:25pt;font-weight:850;line-height:1.15}.paper-translation{width:100%;font-size:17pt;font-weight:750;line-height:1.22}.paper-translation .hebrew{font-size:17pt}.paper-translation-block+.paper-translation-block{margin-top:10pt}.paper-context{width:100%;margin-top:10pt;padding-top:7pt;border-top:.5pt solid #bbb;font-size:8.5pt;font-weight:400;line-height:1.25}.paper-context p{margin:0}.paper-context p+p{margin-top:10pt}.paper-context .context-quote{font-size:10pt}.paper-context .context-citation{margin-top:4pt;color:#555;font-size:6.8pt}.paper-empty{background:#fff}
body.print-preview-open .app{display:none}body.print-preview-open .print-preview{display:block}
@media(max-width:880px){header{grid-template-columns:1fr}.layout{grid-template-columns:1fr}.panel{position:static}.controls,.ratings{grid-template-columns:1fr}}
@media(max-width:850px){.print-preview{overflow:auto}.print-toolbar{width:100%;flex-wrap:wrap}.print-toolbar-copy{flex-basis:100%}.paper-sheet,.sheet-caption{margin-left:0}}
@page{size:letter portrait;margin:0}
@media print{body.print-preview-open{background:#fff}body.print-preview-open .app,body.print-preview-open .print-toolbar,body.print-preview-open .sheet-caption{display:none!important}body.print-preview-open .print-preview{display:block!important;padding:0;background:#fff}body.print-preview-open .paper-sheet{margin:0;box-shadow:none;break-after:page;page-break-after:always}body.print-preview-open .paper-sheet:last-child{break-after:auto;page-break-after:auto}}
</style>
</head>
<body><div class="app">
<header><div><a class="home-link" href="${escapeHtml(homeUrl)}">← Class home</a><h1>${safeTitle}</h1></div><div class="badge"><span id="count">${cards.length}</span><span>cards</span></div></header>
<main class="layout"><aside class="panel">

<p class="section-title" style="margin-top:16px">Flip order</p><div class="orders"><button id="termFirst" class="active">Term - Definition</button><button id="translationFirst">Definition - Term</button></div>
<div class="actions"><button id="shuffle">Shuffle</button><button id="reset">Reset</button></div>
<div class="stats"><div class="stat"><b id="knownCount">0</b><span>Know</span></div><div class="stat"><b id="almostCount">0</b><span>Almost</span></div><div class="stat"><b id="learningCount">0</b><span>Learning</span></div></div>
<p class="note">Keyboard: space flips to the next side; arrow keys move between cards.</p>
<p class="section-title" style="margin-top:16px">Paper Flashcards</p><button id="paperCards" style="width:100%">Print Paper Flashcards</button>
${Object.keys(groups).length ? '<button id="gamify" class="gamify-button" type="button">Gamify!</button>' : ''}
</aside><section class="stage"><div class="topbar"><span id="position"></span><div class="progress"><div id="bar" class="bar"></div></div></div>
<div class="card-area"><article id="card" class="card" tabindex="0"><div id="cardNumber" class="corner"></div><div id="sideNumber" class="side"></div><div id="sideLabel" class="label"></div><div class="card-content"><div id="cardSizing" class="main card-sizing" aria-hidden="true"></div><div id="mainText" class="main"></div></div></article></div>
<div id="cardContext" class="context" hidden><div class="label">Use in Context</div><p id="contextQuote" class="context-he hebrew"></p><p id="hebrewContext" class="context-he-translation hebrew"></p><p id="englishContext" class="context-en"></p><div class="citation"><span id="englishSource"></span><span id="hebrewSource" class="hebrew"></span></div></div>
<div class="controls"><button id="previous">← Previous</button><button id="flip" class="primary">Flip</button><button id="next">Next →</button></div><div class="ratings"><button class="know" data-rating="known">I know it</button><button class="almost" data-rating="almost">Almost</button><button class="learning" data-rating="learning">Still learning</button></div>
</section></main></div>

<section id="printPreview" class="print-preview"><div class="print-toolbar"><div class="print-toolbar-copy"><strong id="printLayoutTitle">Eight paper flashcards per sheet</strong><small>Print double-sided at 100% or Actual Size, choose Flip on long edge, and turn off browser headers and footers.</small></div><button id="closePrintPreview" type="button">Back to Study Cards</button><button id="printNow" class="print-now" type="button">Print Flashcards</button></div><div id="printPages"></div></section>
<script id="peninaClassConfig" type="application/json">${JSON.stringify({leaderboardUrl:options.leaderboardUrl||'',matchingUrl:options.matchingUrl||''}).replace(/</g, '\\u003c')}</script>
<script id="peninaCardData" type="application/json">${cardData}</script>
<script>
const originalCards=${cardData};let cards=[...originalCards],index=0,sideIndex=0,termFirst=true,ratings={},animating=false;
const byId=id=>document.getElementById(id);const esc=value=>String(value||'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function rich(value,runs){const text=String(value||''),valid=Array.isArray(runs)&&runs.map(run=>String(run&&run.text||'')).join('')===text;if(!valid)return esc(text);return runs.map(run=>(run&&run.bold?'<strong>':'')+esc(run&&run.text||'')+(run&&run.bold?'</strong>':'')).join('')}
function order(card){return termFirst?['term','definition']:['definition','term']}
function filterCards(){cards=originalCards.filter(card=>ratings[card.n]!=='known');if(index>=cards.length)index=0;byId('count').textContent=cards.length}
function renderStats(){const values=Object.values(ratings);byId('knownCount').textContent=values.filter(value=>value==='known').length;byId('almostCount').textContent=values.filter(value=>value==='almost').length;byId('learningCount').textContent=values.filter(value=>value==='learning').length}
function setVisible(id,visible){byId(id).hidden=!visible}
function printTerm(card,settings){return '<div class="paper-card-header"><span class="paper-card-title" dir="auto">'+esc(document.title)+'</span><span class="paper-card-number">#'+card.n+'</span></div><div class="paper-card-content"><div class="paper-term hebrew">'+esc(card.term)+'</div>'+(!termFirst?printContext(card,settings):'')+'</div>'}
function getPrintSettings(){return {count:8,translation:'both',originalQuote:true,hebrewContext:true,englishContext:true}}
function printTranslations(card,settings){let main=[];if(settings.translation!=='english'&&card.hebrew)main.push('<div class="paper-translation-block hebrew">'+esc(card.hebrew)+'</div>');if(settings.translation!=='hebrew'&&card.english)main.push('<div class="paper-translation-block">'+esc(card.english)+'</div>');return '<div class="paper-card-content"><div class="paper-translation">'+(main.join('')||'<div class="paper-translation-block">No translation available</div>')+'</div>'+(termFirst?printContext(card,settings):'')+'</div>'}
function printContext(card,settings){let context=[];if(settings.originalQuote&&card.contextQuote)context.push('<p class="context-quote hebrew">'+rich(card.contextQuote,card.contextQuoteRuns)+'</p>');if(settings.hebrewContext&&card.hebrewTranslation)context.push('<p class="hebrew">'+rich(card.hebrewTranslation,card.hebrewTranslationRuns)+'</p>');if(settings.englishContext&&card.englishTranslation)context.push('<p>'+rich(card.englishTranslation,card.englishTranslationRuns)+'</p>');const citations=[];if(settings.englishContext&&card.sourceEnglish)citations.push(card.sourceEnglish);if((settings.originalQuote||settings.hebrewContext)&&card.sourceHebrew&&!citations.includes(card.sourceHebrew))citations.push(card.sourceHebrew);if(context.length&&citations.length)context.push('<p class="context-citation">'+citations.map(esc).join(' · ')+'</p>');return context.length?'<div class="paper-context">'+context.join('')+'</div>':''}
function paperCard(card,side,settings){if(!card)return '<article class="paper-card paper-empty" aria-hidden="true"></article>';return '<article class="paper-card'+(side==='term'?' paper-card-front':'')+'">'+(side==='term'?printTerm(card,settings):printTranslations(card,settings))+'</article>'}
function paperSheet(group,side,back,settings){const front=Array.from({length:settings.count},(_,position)=>position),positions=back?front.map(position=>position%2===0?position+1:position-1):front;return '<div class="sheet-caption">'+(side==='term'?'Term':'Definition')+' side</div><section class="paper-sheet '+(settings.count===6?'six-up':'eight-up')+'">'+positions.map(position=>paperCard(group[position],side,settings)).join('')+'</section>'}
function buildPrintPreview(){if(!originalCards.length)return;const settings=getPrintSettings();let pages='';for(let start=0;start<originalCards.length;start+=settings.count){const group=originalCards.slice(start,start+settings.count);pages+=paperSheet(group,termFirst?'term':'translation',false,settings)+paperSheet(group,termFirst?'translation':'term',true,settings)}byId('printLayoutTitle').textContent=(settings.count===6?'Six':'Eight')+' paper flashcards per sheet';byId('printPages').innerHTML=pages;document.body.classList.add('print-preview-open');window.scrollTo(0,0)}
function render(){filterCards();renderStats();if(!cards.length){setVisible('cardContext',false);byId('cardSizing').innerHTML='';byId('position').textContent='0 / 0';byId('bar').style.width='0%';byId('mainText').textContent='No cards remaining';byId('sideLabel').textContent='';byId('sideNumber').textContent='';return}const card=cards[index],sides=order(card);if(sideIndex>=sides.length)sideIndex=0;const side=sides[sideIndex];byId('position').textContent=(index+1)+' / '+cards.length;byId('bar').style.width=((index+1)/cards.length*100)+'%';byId('cardNumber').textContent='Card #'+card.n;byId('sideNumber').textContent=sides.length?(sideIndex+1)+' / '+sides.length:'0 / 0';byId('cardSizing').innerHTML='<div class="term-sizing hebrew">'+esc(card.term||'No term available')+'</div><div class="definition-sizing">'+((card.hebrew?'<div class="hebrew">'+esc(card.hebrew)+'</div>':'')+(card.english?'<div dir="ltr">'+esc(card.english)+'</div>':'')||'No definition available')+'</div>';byId('sideLabel').textContent=side==='term'?'Term':'Definition';byId('mainText').className='main';if(side==='term'){byId('mainText').textContent=card.term||'No term available';byId('mainText').className='main hebrew'}else{byId('mainText').innerHTML=(card.hebrew?'<div class="hebrew">'+esc(card.hebrew)+'</div>':'')+(card.english?'<div dir="ltr">'+esc(card.english)+'</div>':'')||'No definition available'}setVisible('cardContext',sideIndex===1&&!!(card.contextQuote||card.hebrewTranslation||card.englishTranslation||card.sourceHebrew||card.sourceEnglish));byId('contextQuote').innerHTML=rich(card.contextQuote,card.contextQuoteRuns);byId('hebrewContext').innerHTML=rich(card.hebrewTranslation,card.hebrewTranslationRuns);byId('englishContext').innerHTML=rich(card.englishTranslation,card.englishTranslationRuns);byId('hebrewSource').textContent=card.sourceHebrew;byId('englishSource').textContent=card.sourceEnglish;}
function move(amount){if(cards.length){index=(index+amount+cards.length)%cards.length;sideIndex=0;render()}}function flip(){if(!cards.length||animating)return;const sides=order(cards[index]);if(sides.length<2)return;animating=true;byId('card').classList.add('flipping');setTimeout(()=>{sideIndex=(sideIndex+1)%sides.length;render();byId('card').classList.remove('flipping');setTimeout(()=>animating=false,190)},180)}
byId('termFirst').onclick=()=>{termFirst=true;sideIndex=0;byId('termFirst').classList.add('active');byId('translationFirst').classList.remove('active');render()};byId('translationFirst').onclick=()=>{termFirst=false;sideIndex=0;byId('translationFirst').classList.add('active');byId('termFirst').classList.remove('active');render()};byId('previous').onclick=()=>move(-1);byId('next').onclick=()=>move(1);byId('flip').onclick=flip;byId('card').onclick=flip;byId('shuffle').onclick=()=>{originalCards.sort(()=>Math.random()-.5);index=0;sideIndex=0;render()};byId('reset').onclick=()=>{ratings={};originalCards.sort((a,b)=>a.n-b.n);index=0;sideIndex=0;render()};byId('paperCards').onclick=buildPrintPreview;byId('closePrintPreview').onclick=()=>{document.body.classList.remove('print-preview-open');window.scrollTo(0,0)};byId('printNow').onclick=()=>window.print();document.querySelectorAll('[data-rating]').forEach(button=>button.onclick=()=>{if(!cards[index])return;ratings[cards[index].n]=button.dataset.rating;button.dataset.rating==='known'?render():move(1)});document.addEventListener('keydown',event=>{if(document.getElementById('gamesDialog')?.open)return;if(document.body.classList.contains('print-preview-open')&&event.key==='Escape'){document.body.classList.remove('print-preview-open');return}if(event.target&&['INPUT','TEXTAREA'].includes(event.target.tagName))return;if(event.key==='ArrowRight')move(1);if(event.key==='ArrowLeft')move(-1);if(event.key===' '){event.preventDefault();flip()}});render();if(window.location && window.location.hash==='#print')buildPrintPreview();
<\/script>${gamesMarkup(groups)}
</body></html>`;
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

    const api = { download, makeApp, toCards, practiceRows, createAsteroids, mountChomp };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.PeninaOfflineStudyCards = api;
})();
