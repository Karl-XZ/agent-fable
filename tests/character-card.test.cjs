const {test}=require('node:test');
const assert=require('node:assert/strict');
const {CharacterCardStore,DEFAULT_FIELDS,CARD_KEY,UNLOCK_KEY,FIELD_LIMITS}=require('../.runtime/character-card-test.cjs');
function storage(){const map=new Map();return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)};}

test('editing unlocks only at an escape settlement and survives reload',()=>{
 const s=storage(),card=new CharacterCardStore(s);
 assert.equal(card.unlocked,false);assert.equal(card.save({personality:'很有个性'}),false);assert.equal(card.payload(),undefined);
 for(const ending of ['fake','stay','jail','loop','swap'])assert.equal(card.unlock(ending),false);
 assert.equal(card.unlock('out'),true);assert.equal(card.unlock('out'),false);
 assert.equal(new CharacterCardStore(s).unlocked,true);
});
test('browser overrides are sparse and isolated from another browser',()=>{
 const s=storage(),card=new CharacterCardStore(s);card.unlock('out');
 assert.equal(card.save({...DEFAULT_FIELDS,speech_style:'有一点机智，短句回答'}),true);
 assert.deepEqual(card.payload().fields,{speech_style:'有一点机智，短句回答'});
 assert.equal(new CharacterCardStore(s).values().speech_style,'有一点机智，短句回答');
 assert.equal(new CharacterCardStore(storage()).payload(),undefined);
 assert.equal(JSON.parse(s.getItem(CARD_KEY)).schema_version,1);
});
test('reset removes only overrides, retaining the escape unlock',()=>{
 const s=storage(),card=new CharacterCardStore(s);card.unlock('out');card.save({personality:'直率'});
 card.reset();assert.equal(s.getItem(CARD_KEY),null);assert.equal(s.getItem(UNLOCK_KEY),'1');assert.equal(card.payload(),undefined);
 assert.deepEqual(card.values(),DEFAULT_FIELDS);
});
test('bad saved data and unknown fields cannot corrupt defaults',()=>{
 const s=storage();s.setItem(UNLOCK_KEY,'1');s.setItem(CARD_KEY,'{bad');const card=new CharacterCardStore(s);
 assert.deepEqual(card.values(),DEFAULT_FIELDS);
 card.save({personality:'x'.repeat(20000),unknown:'do not retain',speech_style:12});
 assert.equal(card.values().personality.length,FIELD_LIMITS.personality);assert.ok(!JSON.stringify(card.payload()).includes('unknown'));
 const copy=card.values();copy.motivation='changed';assert.equal(card.values().motivation,DEFAULT_FIELDS.motivation);
});
test('blocked browser storage reports ephemeral settings without crashing',()=>{
 const card=new CharacterCardStore({getItem(){throw Error('blocked')},setItem(){throw Error('blocked')},removeItem(){throw Error('blocked')}});
 assert.equal(card.unlocked,false);assert.equal(card.unlock('out'),true);assert.equal(card.save({personality:'谨慎'}),true);
 assert.equal(card.storageError,true);assert.equal(card.payload().fields.personality,'谨慎');
});
test('saving and resetting send no network request',()=>{
 const original=global.fetch;global.fetch=()=>{throw Error('editing must not use the network')};
 try{const card=new CharacterCardStore(storage());card.unlock('out');card.save({personality:'活泼'});card.reset();}finally{global.fetch=original;}
});
