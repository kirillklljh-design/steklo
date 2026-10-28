const TABLES = { works: 'zerkalo_works', reviews: 'zerkalo_reviews', owners: 'zerkalo_owners' };
const BUCKET = 'zerkalo-works';
const MAX_BYTES = 10 * 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

function text(value, label, max, required = true) {
  const result = String(value ?? '').trim();
  if ((required && !result) || result.length > max) throw new Error('Проверьте поле «' + label + '».');
  return result;
}
function workFields(work) {
  const price = Number(work.price);
  if (!Number.isSafeInteger(price) || price < 0 || price > 2147483647) throw new Error('Проверьте цену работы.');
  return { title: text(work.title, 'Название', 90), description: text(work.description, 'Описание', 500),
    size: text(work.size, 'Размер', 30, false), price };
}
function reviewFields(review) {
  return { author: text(review.author || 'Отзыв клиента', 'Автор', 80), text: text(review.text, 'Отзыв', 1200, false),
    date_label: text(review.date ?? review.date_label, 'Дата', 50, false) };
}
function checked(result) {
  if (result.error) throw new Error(result.error.message || 'Не удалось сохранить данные.');
  return result.data;
}
function identifier(id) {
  if (!uuid.test(id)) throw new Error('Некорректная запись. Обновите страницу.');
  return id;
}
function photoCheck(file) {
  if (!file || !imageTypes.has(file.type) || !file.size || file.size > MAX_BYTES) {
    throw new Error('Выберите фото JPG, PNG или WebP размером до 10 МБ.');
  }
}

export function createContentStore(client, { fetchImpl = globalThis.fetch, baseUrl = globalThis.location?.href || 'http://localhost/' } = {}) {
  const bucket = client.storage.from(BUCKET);
  const cloudImageBase = bucket.getPublicUrl('').data.publicUrl;
  const imageUrl = path => /^seed\/work-\d{2}\.jpg$/.test(path) ? '/assets/' + path.slice(5) : bucket.getPublicUrl(path).data.publicUrl;
  const pathsOf = row => row?.image_paths ?? (row?.image_path ? [row.image_path] : []);
  const gallery = row => pathsOf(row).map(path => ({path, url:imageUrl(path)}));
  const mapWork = row => ({ id: row.id, ...workFields(row), photos: gallery(row), imagePath: row.image_path, image: imageUrl(row.image_path), sortOrder: row.sort_order });
  const mapReview = row => ({ id: row.id, author: row.author, photos: gallery(row), text: row.text, date: row.date_label, sortOrder: row.sort_order, imagePath: row.image_path, image: row.image_path ? imageUrl(row.image_path) : '' });
  const queryRows = async table => checked(await client.from(table).select('*').order('sort_order').order('created_at'));
  const listWorks = async () => (await queryRows(TABLES.works)).map(mapWork);
  const listReviews = async () => (await queryRows(TABLES.reviews)).map(mapReview);

  async function isOwner() {
    const { data, error } = await client.auth.getUser();
    if (error || !data?.user) return false;
    const rows = checked(await client.from(TABLES.owners).select('user_id').eq('user_id', data.user.id).limit(1));
    return rows.some(row => row.user_id === data.user.id);
  }
  async function requireOwner() {
    if (!await isOwner()) throw new Error('Нет прав владельца. Войдите в аккаунт владельца сайта.');
  }
  async function upload(file) {
    photoCheck(file);
    const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type];
    const path = crypto.randomUUID() + '.' + extension;
    checked(await bucket.upload(path, file, { contentType: file.type, upsert: false }));
    return path;
  }
  async function removePhotos(paths) {
    const cloudPaths = paths.filter(path => path && !path.startsWith('seed/'));
    if (!cloudPaths.length) return true;
    try { checked(await bucket.remove(cloudPaths)); return true; } catch { return false; }
  }

  async function saveGallery(type, record, photoInput) {
    const fields = type === 'works' ? workFields(record) : reviewFields(record);
    await requireOwner();
    const existing = record.id ? checked(await client.from(TABLES[type]).select('*').eq('id', identifier(record.id)).single()) : null;
    const oldPaths = pathsOf(existing);
    const drafts = Array.isArray(photoInput) ? photoInput : photoInput ? [{file:photoInput}] : record.removeImage ? [] : oldPaths.map(path=>({path}));
    if(drafts.length>10) throw new Error('Можно добавить до 10 фотографий.');
    if(!drafts.length && (type==='works'||!fields.text)) throw new Error('Добавьте текст или фотографию отзыва. Для работы нужно хотя бы одно фото.');
    for(const draft of drafts) { if(draft.file) photoCheck(draft.file); else if(!oldPaths.includes(draft.path)) throw new Error('Неизвестная фотография. Обновите запись.'); }
    const uploaded=[], paths=[];
    let saved;
    try {
      for(const draft of drafts) { if(draft.file) {const path=await upload(draft.file); uploaded.push(path); paths.push(path);} else paths.push(draft.path); }
      const row={...fields,id:existing?.id||crypto.randomUUID(),image_path:paths[0]||null,image_paths:paths,sort_order:existing?.sort_order??0,updated_at:new Date().toISOString()};
      const query=existing?client.from(TABLES[type]).update(row).eq('id',row.id):client.from(TABLES[type]).insert(row);
      saved=checked(await query.select('*').single());
    } catch(error) { await removePhotos(uploaded); throw error; }
    const cleaned=await removePhotos(oldPaths.filter(path=>!paths.includes(path)));
    return {...(type==='works'?mapWork(saved):mapReview(saved)),cleanupWarning:!cleaned};
  }
  const saveWork=(record,photos)=>saveGallery('works',record,photos);
  const saveReview=(record,photos)=>saveGallery('reviews',record,photos);
  async function deleteGallery(type,id) {
    await requireOwner();
    const row=checked(await client.from(TABLES[type]).delete().eq('id',identifier(id)).select('*').single());
    return {cleanupWarning:!await removePhotos(pathsOf(row))};
  }
  const deleteWork=id=>deleteGallery('works',id);
  const deleteReview=id=>deleteGallery('reviews',id);

  async function readImage(source) {
    if (typeof source !== 'string' || !source) throw new Error('В копии отсутствует фото работы.');
    if (source.startsWith('data:')) {
      if (!/^data:image\/(jpeg|png|webp);base64,/i.test(source) || source.length > MAX_BYTES * 1.4) throw new Error('Некорректное фото в копии.');
    } else {
      const url = new URL(source, baseUrl);
      const localAsset = url.origin === new URL(baseUrl).origin && /^\/assets\/[\w.-]+\.(jpg|jpeg|png|webp)$/i.test(url.pathname);
      if (!localAsset && !url.href.startsWith(cloudImageBase)) throw new Error('Фото в копии должно быть встроено или находиться на этом сайте.');
      source = url.href;
    }
    const response = await fetchImpl(source, { credentials: 'omit' });
    if (!response.ok) throw new Error('Не удалось загрузить фото из копии.');
    const blob = await response.blob();
    photoCheck(blob);
    return blob;
  }

  async function importLegacyContent(payload, mode = 'append') {
    await requireOwner();
    if (!payload || !Array.isArray(payload.works) || !Array.isArray(payload.reviews) ||
      payload.works.length + payload.reviews.length > 200) throw new Error('Неверный формат копии или более 200 записей.');
    const works = payload.works.map(workFields);
    const reviews = payload.reviews.map(reviewFields);
    if (mode === 'replace-empty' && ((await listWorks()).length || (await listReviews()).length)) {
      throw new Error('В базе уже есть записи. Выберите добавление без замены.');
    }
    const paths = [];
    try {
      const reviewRows = reviews.map((review,i)=>({...review,id:crypto.randomUUID(),sort_order:i}));
      for (const [rows, originals, isWork] of [[works,payload.works,true],[reviewRows,payload.reviews,false]]) {
        for(let i=0;i<rows.length;i++) {
          const sources=originals[i].photos?.map(p=>typeof p==='string'?p:p.url) ?? (originals[i].image?[originals[i].image]:[]);
          if(sources.length>10 || (!sources.length&&(isWork||!rows[i].text))) throw new Error('Проверьте фотографии в копии (до 10 на запись).');
          const image_paths=[];
          for(const source of sources) {const path=await upload(await readImage(source));paths.push(path);image_paths.push(path);}
          rows[i]={...rows[i],id:crypto.randomUUID(),sort_order:i,image_paths,image_path:image_paths[0]||null};
        }
      }
      return checked(await client.rpc('zerkalo_import_content', { p_works: works, p_reviews: reviewRows }));
    } catch (error) {
      const cleaned = await removePhotos(paths);
      if (!cleaned) error.message += ' Часть загруженных фото осталась в хранилище; записи не заменялись.';
      throw error;
    }
  }
  async function exportContent() {
    await requireOwner();
    const works = await listWorks();
    const reviews = await listReviews();
    for(const record of [...works,...reviews]) {
      const photos=[];
      for(const photo of record.photos) {
        const blob=await readImage(photo.url); const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';
        for(let start=0;start<bytes.length;start+=32768) binary+=String.fromCharCode(...bytes.subarray(start,start+32768));
        photos.push('data:'+blob.type+';base64,'+btoa(binary));
      }
      record.photos=photos;record.image=photos[0]||'';
    }
    return { version: 2, works, reviews };
  }
  return { listWorks, listReviews, isOwner, saveWork, deleteWork, saveReview, deleteReview, importLegacyContent, exportContent };
}
