---
name: myth-trace-art
description: Build embodied audiovisual artworks that combine philosophical text, source or generated voice, live camera tracking of hands/body/face/objects, WebGL2 or Hydra-style feedback, projector performance, local recording, reel editing and a public case page. Use for Myth Trace, tracked poetry, camera-as-instrument, agent/body video art, interactive projection, or turning a live tracking session into a finished reel and reusable art artifact.
---

# Myth Trace Art

Собирать одно произведение по цепочке **тезис → голос → тело → трекинг → изображение/звук → запись → рилс → публичный кейс**. Сохранять причинную связь между жестом и эффектом: зритель должен видеть, почему система изменилась.

## Быстрый маршрут

1. Зафиксировать один философский вопрос и одно наблюдаемое действие финала.
2. Выбрать runtime по таблице ниже.
3. Описать сигналы как `EVENT`, `RANGE` или `ABSENCE` до написания кода.
4. Собрать локальный performance-инструмент и пройти pointer fallback до разрешений камеры.
5. Зафиксировать текст, создать/подключить голос, отрепетировать один длинный take.
6. Проанализировать take через `scripts/audit_take.py`.
7. Собрать чистый мастер и четыре сравнимые вариации через `$reel-edit`.
8. Проверить речь, loudness, ориентацию и финальный кадр.
9. Упаковать skill/кейс через `scripts/package_public.py`; публиковать только безопасные производные ассеты.
10. Для личного релиза собрать OG-cover, 7-слайдовую карусель и короткий пост из тех же кадров, тезиса и causal map.

## Контракт готового результата

Завершённый Myth Trace релиз содержит один воспроизводимый набор:

| Слой | Обязательный результат |
|---|---|
| произведение | locked text, causal map, last image и один выбранный source voice |
| runtime | локальная сцена с pointer fallback, hand/pose/face tracking, panic и projector mode |
| звук | один shared local master; жест запускает `EVENT`, движение меняет `RANGE`, отсутствие закрывает gate |
| запись | immutable source take, probe/receipt и master с сохранённой речью |
| монтаж | пять сравнимых reel masters, один audio spine, EDL/manifest и contact sheet |
| covers | 5 геометрий × 4 визуальные системы = 20 вариантов, ZIP и manifest |
| public case | performance evidence, явный voice playback, causal map, downloadable skill и checksum |
| QA | browser desktop/mobile, reduced motion, asset/status scan, loudness, captions и privacy boundary |

Не считать релиз готовым, пока публичный кейс обещает больше, чем доказано runtime, или пока checksum на странице отличается от manifest.

## Выбор runtime

| Задача | Выбор |
|---|---|
| Живое тело, руки, объекты, delayed portals, проектор | существующий MythTrace или новый zero-dependency WebGL2 проект через `$video-art` |
| Мгновенный shader/VJ sidecar и live coding | `$hydra-live` |
| Сложный native GPU pipeline | ModernGL + MediaPipe |
| Projection mapping, OSC/MIDI/DMX, внешний граф | TouchDesigner |
| Монтаж записанного перформанса | `$reel-edit` + ffmpeg |

Не добавлять новый framework, если WebGL2, Canvas2D и Python stdlib закрывают задачу. Для проекта MythTrace читать его локальный `AGENTS.md` и frozen SPEC-файлы перед изменениями.

## Сформулировать произведение

Зафиксировать перед кодом:

- **question** – один вопрос, который машина не может закрыть сама;
- **body action** – жест, подход, замирание, исчезновение или возврат;
- **machine claim** – что система считает знанием;
- **visible limit** – где измерение перестаёт быть телом;
- **last image** – действие, завершающее смысл без дополнительного титра.

Писать текст под наблюдаемое действие. Зафиксировать финальную версию до генерации голоса и монтажа. После lock не переписывать слова ради темпа.

## Построить карту сигналов

Объявить каждый маппинг:

| Слой | Тип | Пример |
|---|---|---|
| pinch / note-on / вход в рамку | `EVENT` | нота, polarity flash, новый портал |
| скорость руки / body energy / расстояние | `RANGE` | feedback, density, filter, bloom |
| потеря лица / пустая рамка / тишина | `ABSENCE` | memory hold, density fall, точный ноль звука |
| narration | timeline spine | проигрывается один раз; тело меняет поле, не запускает случайные строки |

Считать отсутствие полноценным сигналом. Держать последний measured anchor ограниченное время, затем явно отпускать. Аудио-гейт при отсутствии входа защёлкивать в точный ноль.

## Собрать live-инструмент

1. Создать SPEC до параллельной работы: exports, data shapes, `CONFIG`, file ownership, privacy, acceptance.
2. Держать координаты трекинга в одном displayed/mirrored пространстве `0..1`; зеркалить ровно один раз.
3. Инициализировать hand/pose/face/object trackers независимо; отказ одного не должен гасить остальные.
4. Сглаживать EMA, сохранять stable IDs и ограниченный loss hold.
5. Разделить WebGL passes и Canvas2D overlay: камера/feedback/bloom в GPU, boxes/labels/crops в overlay.
6. Оставить pointer fallback и явный статус до разрешения камеры.
7. Держать camera pixels, raw mic, tracking frames и MIDI локально.
8. Дать `panic`, fullscreen, mirror, calibration и видимый preflight.

Для полного стека и команд читать [references/stack.md](references/stack.md). Для готовых mappings читать [references/examples.md](references/examples.md).

### Кодовый контракт

- держать zero-build ES modules; не добавлять framework, bundler или runtime CDN без доказанной необходимости;
- держать все тюнинги в `CONFIG`, а разрешения – только внутри явных пользовательских действий;
- разделять `tracking`, `mapping`, `render`, `overlay`, `audio`, `capture` и `stage facts` по владельцам;
- инициализировать MediaPipe tasks независимо и сохранять pointer fallback при любом отказе;
- использовать фиксированные WebGL buffers/textures; не аллоцировать в горячем render loop;
- нормализовать Web MIDI и CoreMIDI bridge в один event shape; не воспроизводить backlog note events;
- проверять exact-zero silence, panic и отсутствие hidden autoplay отдельными тестами.

При реализации читать [references/implementation-recipes.md](references/implementation-recipes.md): там зафиксированы module map, `EVENT/RANGE/ABSENCE`, координаты, tracker lifecycle, pointer crop, WebGL ping-pong, gesture sound, MIDI, capture и soft update с кодом.

## Голос и звук

- Ставить авторский source voice первым выбором, если телесное присутствие является частью работы.
- Создавать TTS только явной кнопкой; отправлять провайдеру лишь видимый locked text.
- Прятать ElevenLabs/OpenRouter keys за localhost proxy; не помещать ключи в browser bundle или public case.
- Строить один `AudioContext`, именованные buses, master compressor/limiter и общий panic.
- Чистить source voice сдержанно: high-pass, low-pass, мягкий denoise, затем two-pass loudness.
- Для рилса целиться в `-16 LUFS` integrated и `-1.5 dBTP`; сохранять естественные паузы в baseline.

### Единый сценический audio bus

Для перформанса все уже **явно запущенные** источники сходятся в один локальный bus: synth/MIDI/жест → `music`, local samples → `samples`, PLAY POEM → `voice`, затем `master` → выбранный выход Chrome/macOS. Этот master можно отдельно, по явному флажку, присоединить к `MediaStreamDestination` для локального AV capture.

- открытие сцены/консоли не создаёт `AudioContext` и не воспроизводит звук;
- reusable `<audio>` с авторским голосом подключается через `createMediaElementSource` только внутри клика `PLAY`, ровно один раз на элемент;
- raw mic остаётся только analyzer/REC-входом и никогда не попадает в capture mix без отдельного, видимого решения;
- в UI показывать настоящий `AudioContext.state`, последнюю causal-команду и **PLAY TEST NOTE**; выбор физического выхода остаётся у Chrome/macOS, не рисовать фиктивный device picker;
- `X`/panic размыкает голоса, sample playback, narration, capture и sidecars до точного нуля.

Это обязательный closing-check для произведения: test note → MIDI → hand pinch → poem → короткий AV take → panic через реальные колонки/проектор.

### Честный stage check

Перед площадкой панель может показывать только уже наблюдаемое runtime-состояние: `webgl2` или safe raster fallback, camera/model counts, `AudioContext`, MIDI device, narration, capture и последний `panic`. Открытие проверки остаётся pure read: без `getUserMedia`, `AudioContext`, MIDI request, `.play()` и capture start.

Browser-ready не доказывает материальный output. После `PLAY TEST NOTE` и `X` оператор вручную слышит фактический Chrome/macOS/projector output и смотрит изображение в комнате.

Для самого room run можно хранить browser-local **operator receipt**: camera/landmarks, projector image, test note, MIDI, hand pinch, poem, local take и panic silence. Каждая отметка – утверждение человека после наблюдения, не авто-вывод из API; чистить receipt при смене venue или output route.

Подробную аудиоархитектуру делегировать `$audio-art`.

## Холодные projection states

Режимы для проекторного перформанса должны отличаться по **причине**, а не только по палитре или плотности.

| Состояние | Тело | Трекерный вход | Временное поведение | Роль в перформансе |
|---|---|---|---|---|
| `SHAPER FIELD` | ясный холодный контур | руки, лицо и объекты рисуют локальное scan/focus поле | короткий контролируемый feedback | начало сета, знакомство с телом и жестом |
| `COLD MEMORY` | остаётся читаемым в центре | body frame задаёт центр | медленные кольца и широкая particle-residue | переход в танец, паузу и память движения |

- Не использовать постоянную инверсию camera luma как единственный эффект режима: она быстро стирает лицо и тело на проекторе.
- У каждого state должен быть свой понятный контроллер: `focus field` для первого, `body centre`/`memory density` для второго.
- `RESET MODE` возвращает restrained default; смена state не создаёт звук и не меняет MIDI mapping.
- Перед площадкой проверить два state без камеры, затем с камерой, потом пройти calibration chart на фактическом проекторе.

## Карта MythTrace – что уже является инструментом

| Контур | Фактический вход | Видимый / слышимый результат | Граница честности |
|---|---|---|---|
| Pointer field | мышь / touch, без permissions | живой WebGL2 field и pointer anchor | не выдавать его за камеру или тело |
| Hands play | landmarks двух рук | pinch edge → quantized chord; index height → pitch; open → filter; spread → echo; curl/motion → texture; two-hand width + motion → 1/2/3 tones | движением не создавать автономный поток нот |
| Body / face | локальные pose и face landmarks | body-centred field, contour, local face frame | `face edge` – художественная лупа, не label мелкой детали |
| Objects | локальный generic object detector или author frame | stable common-object/person box и selected object crop | не обещать серьгу, произвольный предмет или семантику без detector evidence |
| Hand frame / author ROI | thumb + index обеих рук | author zone: paint, prompt recipe, object crop, **exact author ROI** или exercise target | ROI – авторская область для мелкого фрагмента, не semantic recognition |
| Audio | screen keys, MIDI, explicit hand pinch, local samples, voice | один shared local master + optional AV take | raw mic не отправляется в master/capture |
| Narration | explicit local source или explicit provider generation | captions/body bending during one chosen poem | playback не запрашивает camera и не повторно генерирует строки от движения |
| SHAPER FIELD / COLD MEMORY | anchors / body frame | читаемый cold contour / body-centred slow residue | `T` меняет visual state, не звук и не MIDI |
| Capture | explicit REC | bounded local visual or opted-in AV take | без upload и без automatic recording |
| Room receipt | explicit operator ticks | browser-local observation of camera/projector/audio/MIDI/gesture/voice/take/panic | не выводить из API state и не считать автоматической сертификацией |

### Следующие расширения без ложных обещаний

1. **ROI feature lock:** поверх уже готового author ROI локально отслеживать feature motion внутри этой области. Подписывать `ROI`, не `object recognised`.
2. **External control:** WebSocket-to-OSC bridge для TouchDesigner/света только как отдельный local process; browser не отправляет UDP напрямую.
3. **Scene score:** сохранять только явные scene/mapping presets, с которым можно повторить performance; не смешивать visual palette с музыкальным preset.
4. **Venue profile:** после реального P0 сохранять отдельный вручную заполненный профиль camera label, projector resolution, audio output observation, MIDI name, date и operator initials без raw camera/audio data.

## Записать и смонтировать

Снимать один длинный take, где монитор, рука и физическое тело образуют один кадр. Считать baked-in tracking, captions и свет частью исходника; не дублировать их декоративным HUD.

Перед монтажом:

```bash
python3 ~/.codex/skills/myth-trace-art/scripts/audit_take.py \
  /absolute/path/to/take.mp4 \
  --out-dir /absolute/path/to/project/analysis
```

Собрать пять версий по одной оси изменения:

1. `clean_breath` – полный ритм и исходная композиция;
2. `screen_focus` – тот же ритм, лёгкий кроп;
3. `phrase_tight` – сокращения только внутри подтверждённых пауз;
4. `phrase_tight_crop` – версия 3 с тем же кропом;
5. `agent_view` – фразовые hard reframes и короткий финальный hold.

Сохранять один audio spine. Не вырезать паузу, пересекающую word timestamps. После монтажа повторно распознать минимум baseline и самую короткую версию; дополнительно проверить каждую удалённую область на нулевое пересечение со словами.

### Пять геометрий релиза

Мастерить одну сцену в пяти фактических размерах:

1. `1080×1350` – feed `4:5`;
2. `1080×1440` – post `3:4`;
3. `1080×1920` – reel/story `9:16`;
4. `1080×1080` – square `1:1`;
5. `1920×1080` – stage/site `16:9`.

Это геометрии доставки, а пять reel versions выше – монтажные гипотезы. Не смешивать две оси в одну таблицу и не выдавать случайный crop за отдельную режиссёрскую версию. Полный release matrix, cover systems и receipt читать в [references/release-formats.md](references/release-formats.md).

## Собрать публичный case

Публичная страница может содержать:

- безопасный mouse/pointer shader preview;
- документальный loop без читаемых приватных экранов;
- source voice только по кнопке, без autoplay;
- короткое описание causal map;
- ссылку на локальный инструмент и downloadable skill package.

Публичный pointer sound field допустим только после явной кнопки: курсор задаёт pitch/filter, скорость открывает activity gate, остановка возвращает gain в точный ноль. Не запускать `AudioContext` на загрузке.

Не публиковать camera API session, raw tracking stream, `.env`, ключи, приватные device labels или внутренний ноутбук крупным читаемым планом. Для AIM использовать только approved `lab-sites/sites/<slug>/` lane и проходить secret scan до push. Читать [references/public-case.md](references/public-case.md) перед интеграцией.

Упаковать текущий skill:

```bash
python3 ~/.codex/skills/myth-trace-art/scripts/package_public.py \
  --out-dir /absolute/path/to/public/site
```

### Социальный пакет

Собирать из того же произведения, без отдельного рекламного мира:

1. OG-cover `1200×630`: реальный performance frame, название, один thesis line и pointer/frame motif.
2. Instagram-карусель `7 × 1080×1350`: hook → pointer → body/gesture → voice → code/skill → privacy → entry.
3. Короткий пост от первого лица: что было собрано, какой жест меняет систему, где запустить и как скачать skill.
4. Asset ledger: источник кадра, автор, права, производный файл и публичность.

На личной карусели держать все заголовки строчными, давать каждому слайду собственную визуальную метафору и включать artifact-preview до финального CTA.

## QA и выдача

Проверить:

- `1080×1920`, корректную rotation metadata, `29.97/30 fps`, BT.709;
- stereo 48 kHz, целевую loudness и true peak;
- отсутствие потерянных слов и обрезанных baked-in captions;
- руку, экран, лицо и финальную пустоту на contact sheet;
- pointer fallback, permission lifecycle, panic и localhost-only requests;
- downloadable zip и checksum публичного skill.

Выдать рекомендованный master, четыре альтернативы, contact sheet, EDL/manifest, два коротких captions и точный список изменений. Не публиковать автоматически без прямого запроса.

## Ресурсы

- [references/stack.md](references/stack.md) – архитектура и полный технический стек.
- [references/examples.md](references/examples.md) – готовые EVENT/RANGE/ABSENCE карты и запросы.
- [references/case-study-agent-body.md](references/case-study-agent-body.md) – разобранный кейс «каково быть агентом?».
- [references/public-case.md](references/public-case.md) – безопасная упаковка сайта и skill.
- [references/implementation-recipes.md](references/implementation-recipes.md) – module map и code recipes для tracking, WebGL, audio, MIDI, capture и soft update.
- [references/release-formats.md](references/release-formats.md) – пять геометрий, пять монтажных версий, cover pack ×20 и release receipt.
- `scripts/audit_take.py` – probe, loudness и contact sheet исходника.
- `scripts/package_public.py` – публичный `.zip`, Markdown copy и SHA-256 manifest.
