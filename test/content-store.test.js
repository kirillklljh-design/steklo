import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backendFixture } from './support/backend.js';
import { createContentStore } from '../src/content-store.js';

const id = '11111111-1111-4111-8111-111111111111';
const old = { id, title: 'Зеркало', description: 'С подсветкой', size: '180 × 70', price: 7000, image_path: 'old.jpg', sort_order: 0 };
const photo = () => new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });
const setup = () => {
  const fixture = backendFixture();
  return { ...fixture, store: createContentStore(fixture.client, { baseUrl: 'http://localhost:8767/' }) };
};

test('public records map database names and images into card values', async () => {
  const { state, store } = setup();
  state.works.push({ ...old, price: 0, image_path: 'seed/work-01.jpg' });
  state.reviews.push({ id, author: 'Анна', text: 'Спасибо!', date_label: '2026', sort_order: 0 });
  assert.equal((await store.listWorks())[0].image, '/assets/work-01.jpg');
  assert.equal((await store.listWorks())[0].price, 0);
  assert.equal((await store.listReviews())[0].date, '2026');
});

test('photo replacement saves the new row before removing the previous photo', async () => {
  const { state, store } = setup();
  state.works.push({ ...old }); state.files.set('old.jpg', 'old');
  const saved = await store.saveWork({ ...old, imagePath: 'old.jpg', price: 8000 }, photo());
  assert.equal(state.works[0].price, 8000);
  assert.equal(state.works[0].image_path, saved.imagePath);
  assert.ok(state.files.has(saved.imagePath));
  assert.equal(state.files.has('old.jpg'), false);
});

test('upload failure preserves existing work and photo', async () => {
  const { state, store } = setup();
  state.works.push({ ...old }); state.files.set('old.jpg', 'old'); state.failUpload = true;
  await assert.rejects(store.saveWork({ ...old, imagePath: 'old.jpg' }, photo()));
  assert.equal(state.works[0].image_path, 'old.jpg');
  assert.deepEqual([...state.files.keys()], ['old.jpg']);
});

test('row write failure removes only the new upload and keeps old content', async () => {
  const { state, store } = setup();
  state.works.push({ ...old }); state.files.set('old.jpg', 'old'); state.failWrite = true;
  await assert.rejects(store.saveWork({ ...old, imagePath: 'old.jpg' }, photo()));
  assert.equal(state.works[0].price, 7000);
  assert.deepEqual([...state.files.keys()], ['old.jpg']);
});

test('non-owner cannot save, delete, or import through the content store', async () => {
  const { state, store } = setup(); state.owner = false;
  await assert.rejects(store.saveReview({ author: 'Анна', text: 'Спасибо' }), /прав/i);
  await assert.rejects(store.deleteWork(id), /прав/i);
  await assert.rejects(store.importLegacyContent({ works: [], reviews: [] }), /прав/i);
  assert.equal(state.reviews.length, 0);
});

test('review editing preserves identity and zero-row writes are errors', async () => {
  const { store, state } = setup();
  const saved = await store.saveReview({ author: 'Анна', text: 'Спасибо!', date: '2026' });
  await store.saveReview({ ...saved, text: 'Очень красивое зеркало' });
  assert.equal(state.reviews.length, 1);
  assert.equal(state.reviews[0].text, 'Очень красивое зеркало');
  await store.deleteReview(saved.id);
  assert.equal(state.reviews.length, 0);
  await assert.rejects(store.saveReview({ ...saved, text: 'Missing' }));
});

test('append import generates fresh IDs without overwriting existing content', async () => {
  const { store, state } = setup(); state.works.push({ ...old });
  const payload = { works: [{ ...old, image: 'data:image/jpeg;base64,cGhvdG8=' }], reviews: [{ id, author: 'Анна', text: 'Отлично', date: '2026' }] };
  await store.importLegacyContent(payload, 'append');
  assert.equal(state.works.length, 2);
  assert.equal(state.works[0].id, id);
  assert.notEqual(state.works[1].id, id);
  assert.notEqual(state.reviews[0].id, id);
  assert.equal(state.reviews[0].date_label, '2026');
});

test('failed atomic import leaves database unchanged and cleans staged photos', async () => {
  const { store, state } = setup(); state.failImport = true; state.works.push({ ...old });
  await assert.rejects(store.importLegacyContent({ works: [{ ...old, image: 'data:image/jpeg;base64,cGhvdG8=' }], reviews: [] }, 'append'));
  assert.deepEqual(state.works, [old]);
  assert.equal(state.files.size, 0);
});

test('invalid prices and untrusted image URLs are rejected before uploads', async () => {
  const { store, state } = setup();
  await assert.rejects(store.saveWork({ ...old, price: -1 }, photo()), /цен/i);
  await assert.rejects(store.importLegacyContent({ works: [{ ...old, image: 'https://untrusted.example/photo.jpg' }], reviews: [] }), /фото/i);
  assert.equal(state.files.size, 0);
});
test('photo-only reviews support replacement, removal and empty rejection', async () => {
 const {store,state}=setup();
 await assert.rejects(()=>store.saveReview({author:'',text:''}), /текст или фотографию/);
 const first=await store.saveReview({author:'',text:''},photo());
 assert.ok(first.image); assert.equal(first.author,'Отзыв клиента');
 const second=await store.saveReview({...first,text:'Спасибо'},photo());
 assert.ok(!state.files.has(first.imagePath)); assert.ok(state.files.has(second.imagePath));
 await store.saveReview({...second,removeImage:true});
 assert.equal(state.files.size,0);
 await assert.rejects(()=>store.saveReview({...second,text:'',removeImage:true}), /текст или фотографию/);
 await store.deleteReview(second.id); assert.equal(state.reviews.length,0);
});
test('gallery ordering and failed updates preserve stored photos', async()=>{
 const {store,state}=setup(); const first=await store.saveWork(old,[{file:photo()},{file:photo()}]).catch(async()=>store.saveWork({...old,id:undefined},[{file:photo()},{file:photo()}]));
 assert.equal(first.photos.length,2);
 const reordered=await store.saveWork(first,[{path:first.photos[1].path},{path:first.photos[0].path}]);assert.equal(reordered.imagePath,first.photos[1].path);
 state.failWrite=true;await assert.rejects(()=>store.saveWork(reordered,[{file:photo()}]));assert.equal(state.files.size,2);state.failWrite=false;
 await store.saveWork(reordered,[{path:reordered.photos[0].path}]);assert.equal(state.files.size,1);
});
