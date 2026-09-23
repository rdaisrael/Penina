const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../PeninaPlus-vocab-builder/offline-study-cards');

test('Wrong answers deduct 25 once, reveal/review phase awards no fuel; only correct answers earn 10', () => {
    const game = app.createAsteroids(), s = game.state;
    assert.equal(s.fuel, 0); assert.equal(game.launch(), false); assert.equal(game.shoot(), false);
    assert.equal(game.answer(false), true);
    assert.equal(s.phase, 'review'); assert.equal(s.score, 275); assert.equal(s.fuel, 0);
    assert.equal(game.answer(false), false); assert.equal(s.score, 275);
    assert.equal(game.answer(true), false); assert.equal(s.fuel, 0);
    assert.equal(game.launch(), false);
    game.nextQuestion(); game.answer(false);
    assert.equal(s.score, 250); assert.equal(s.fuel, 0);
    game.nextQuestion(); game.answer(true);
    assert.equal(s.fuel, 10); assert.equal(s.correct, 1); assert.equal(s.incorrect, 2);
    assert.equal(s.score, 250); assert.equal(s.phase, 'ready');
    assert.equal(game.answer(true), false); assert.equal(s.fuel, 10);
    assert.equal(game.launch(), true);
});

test('Each shot uses one bullet, cannot overspend, and waits for last shot before asking again', () => {
    const game = app.createAsteroids(), s = game.state;
    game.answer(true); game.launch();
    for (let i = 0; i < 10; i++) { s.cooldown = 0; assert.equal(game.shoot(), true); assert.equal(s.fuel, 9-i); }
    assert.equal(game.shoot(), false);
    assert.equal(s.phase, 'flying');
    s.bullets = [{ x: 600, y: 400, vx: 0, vy: 0, ttl: .03 }];
    s.rocks = [{size:'large',radius:42,x:30,y:30,vx:0,vy:0,angle:0,spin:0}];
    game.tick(.02); assert.equal(s.phase, 'flying');
    game.tick(.02); assert.equal(s.phase, 'question');
    const snapshot = JSON.stringify(s);
    game.tick(.03, {thrust:true, fire:true}); assert.equal(JSON.stringify(s), snapshot);
    game.answer(false); assert.equal(s.fuel, 0);
    game.nextQuestion(); game.answer(true); assert.equal(s.fuel, 10);
});

test('Different asteroid sizes earn 20/50/100 points and split into the next smaller size', () => {
    for (const [size, points, next] of [['large',20,'medium'],['medium',50,'small'],['small',100,null]]) {
        const game = app.createAsteroids(), s = game.state;
        game.answer(true); game.launch();
        const target={size,radius:20,x:100,y:100,vx:0,vy:0,angle:0,spin:0};
        const other={size:'large',radius:42,x:800,y:400,vx:0,vy:0,angle:0,spin:0};
        s.rocks=[target,other]; s.bullets=[{x:100,y:100,vx:0,vy:0,ttl:1}];
        game.tick(.01);
        assert.equal(s.score, 300+points); assert.equal(s.hits, 1);
        assert.equal(s.rocks.length, next ? 3 : 1);
        if (next) assert.equal(s.rocks.filter(r=>r.size===next).length, 2);
        game.tick(.01); assert.equal(s.score, 300+points, 'A bullet cannot score twice');
    }
});

test('Pause freezes position, score, and fuel cells; collisions deduct 150 points and respawn', () => {
    const game = app.createAsteroids(), s = game.state;
    game.answer(true); game.launch(); game.tick(.03,{thrust:true,fire:true}); game.pause();
    const snapshot=JSON.stringify(s);
    game.tick(.03,{thrust:true,fire:true}); assert.equal(JSON.stringify(s),snapshot);
    assert.equal(game.shoot(),false); game.launch();
    s.ship.x=100;s.ship.y=100;s.ship.shield=0;
    s.rocks=[{size:'large',radius:42,x:100,y:100,vx:0,vy:0,angle:0,spin:0}];s.bullets=[];
    game.tick(.01);assert.equal(s.ship.x,450);assert.equal(s.ship.y,250);assert.equal(s.score,150);assert.equal(s.fuel,9);
});

test('Asteroids is embedded offline only with valid teacher-created alternatives', () => {
    const card={term:'סוס',english:'horse',alternativeAnswers:{english:{term:'סוס',definition:'horse',answers:['dog','cat','fish','bird']}}};
    const html=app.makeApp('Test',[card]);
    assert(html.includes('data-game="asteroids"'));
    assert(html.includes('function createAsteroids('));assert(html.includes('function mountAsteroids('));
    delete card.alternativeAnswers;
    assert(!app.makeApp('Test',[card]).includes('data-game="asteroids"'));
});

test('Three finite rounds introduce pursuing Martians then shooting ships, ending with victory', () => {
    const game=app.createAsteroids(()=>.5),s=game.state;
    game.answer(true);game.launch();s.rocks=[];game.tick(.01);
    assert.equal(s.wave,2);assert.equal(s.enemies.length,4);assert(s.enemies.every(e=>e.kind==='martian'));
    const enemy=s.enemies[0], before=Math.hypot(enemy.x-s.ship.x,enemy.y-s.ship.y);game.tick(.03);
    assert(Math.hypot(enemy.x-s.ship.x,enemy.y-s.ship.y)<before);
    s.rocks=[];s.enemies=[];game.tick(.01);
    assert.equal(s.wave,3);assert.equal(s.enemies.length,5);assert(s.enemies.every(e=>e.kind==='ship'));
    s.enemies[0].cooldown=0;game.tick(.03);assert.equal(s.enemyShots.length,1);
    s.rocks=[];s.enemies=[];game.tick(.01);assert.equal(s.phase,'won');assert.equal(s.wave,3);
    const snapshot=JSON.stringify(s);game.tick(.03,{fire:true});assert.equal(JSON.stringify(s),snapshot);
});

test('Rock, Martian and enemy fire damage can end a game; terminal states cannot refuel or launch', () => {
    for(const hazard of ['rock','martian','shot']) {
        const game=app.createAsteroids(),s=game.state;game.answer(true);game.launch();s.score=100;s.ship.shield=0;
        const target={x:s.ship.x,y:s.ship.y,radius:20,vx:0,vy:0,angle:0,spin:0,size:'large',kind:'martian',ttl:1};
        if(hazard==='rock')s.rocks=[target];
        if(hazard==='martian')s.enemies=[target];
        if(hazard==='shot')s.enemyShots=[target];
        game.tick(.01);assert.equal(s.score,0);assert.equal(s.phase,'gameover');
        assert.equal(game.answer(true),false);assert.equal(game.launch(),false);assert.equal(game.shoot(),false);
    }
});

test('A wrong answer cannot make score negative and reaching zero ends the game',()=>{
    const game=app.createAsteroids();game.state.score=25;game.answer(false);
    assert.equal(game.state.score,0);assert.equal(game.state.phase,'gameover');assert.equal(game.nextQuestion(),false);
});

test('Player shots leave the arena without wrapping, and do not hit targets across the seam',()=>{
 const game=app.createAsteroids(),s=game.state;game.answer(true);game.launch();
 s.rocks=[{size:'large',radius:42,x:5,y:100,vx:0,vy:0,angle:0,spin:0}];
 s.bullets=[{x:899,y:100,vx:520,vy:0,ttl:1}];game.tick(.01);
 assert.equal(s.bullets.length,0);assert.equal(s.rocks.length,1);assert.equal(s.score,300);
 s.ship.x=899;s.ship.y=250;s.ship.vx=200;s.ship.shield=0;game.tick(.03);assert(s.ship.x<10);
});
test('Firing the first shot costs fuel only; returning from a vocabulary question grants protection',()=>{
 const game=app.createAsteroids(),s=game.state;s.ship.shield=0;game.answer(true);game.launch();
 assert(s.ship.shield>=3);game.shoot();assert.equal(s.score,300);assert.equal(s.fuel,9);
 s.rocks=[{size:'large',radius:42,x:s.ship.x,y:s.ship.y,vx:0,vy:0,angle:0,spin:0}];
 game.tick(.01);assert(s.score>=300);assert.equal(s.lastDamage,undefined);
});

test('Five distinct jet bursts require a new answer; holding counts once and refilling resets both supplies',()=>{
 const game=app.createAsteroids(),s=game.state;game.answer(true);game.launch();s.ship.shield=100;
 assert.equal(s.jets,5);
 for(let burst=0;burst<5;burst++){
  game.tick(.01,{thrust:true});assert.equal(s.jets,4-burst);assert.equal(s.phase,'flying');
  for(let frame=0;frame<10;frame++)game.tick(.01,{thrust:true});
  assert.equal(s.jets,4-burst);game.tick(.01,{});
  assert.equal(s.phase,burst===4?'question':'flying');
 }
 const snapshot=JSON.stringify(s);game.tick(.01,{thrust:true,fire:true});assert.equal(JSON.stringify(s),snapshot);
 game.answer(false);assert.equal(s.jets,0);game.nextQuestion();game.answer(true);assert.equal(s.jets,5);assert.equal(s.fuel,10);
 game.launch();game.tick(.01,{thrust:true});game.pause();game.tick(.01,{thrust:true});assert.equal(s.jets,4);game.launch();game.tick(.01,{thrust:true});assert.equal(s.jets,4);
});
