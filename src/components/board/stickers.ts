/* Content for the Miro-style toolbar: note colours, stickers, stamps,
   colour-temperature swatches and templates. Plain data, no React. */

export const NOTE_COLORS = [
  { id: 'yellow', fill: '#fff2a8', edge: '#e6c84f' },
  { id: 'orange', fill: '#ffd8a8', edge: '#f08c3a' },
  { id: 'pink', fill: '#ffc9de', edge: '#e64980' },
  { id: 'green', fill: '#c3f0c8', edge: '#40a35a' },
  { id: 'blue', fill: '#c5e3ff', edge: '#3b82d6' },
  { id: 'purple', fill: '#e5d4ff', edge: '#8458d6' },
  { id: 'gray', fill: '#e9ecef', edge: '#868e96' },
];

/** Flat emoji, grouped like an emoji picker. Rendered with the device's emoji font. */
export const EMOJI_GROUPS: Array<{ id: string; en: string; vi: string; items: string[] }> = [
  { id: 'smileys', en: 'Smileys', vi: 'Mặt cười', items: '😀 😃 😄 😁 😆 😅 😂 🤣 🥲 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥸 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🫣 🤭 🫢 🤫 🤥 😶 😐 😑 😬 🫠 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕'.split(' ') },
  { id: 'gestures', en: 'Gestures', vi: 'Cử chỉ', items: '👍 👎 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👋 🤚 🖐️ ✋ 🖖 👏 🙌 🫶 👐 🤲 🤝 🙏 ✍️ 💪 👀 🧠 🫡'.split(' ') },
  { id: 'hearts', en: 'Hearts', vi: 'Tim', items: '❤️ 🧡 💛 💚 💙 🩵 💜 🤎 🖤 🩶 🤍 🩷 💖 💗 💓 💞 💕 💘 💝 💟 ❣️ 💔 ❤️‍🔥 💌 💋'.split(' ') },
  { id: 'symbols', en: 'Symbols', vi: 'Ký hiệu', items: '✅ ☑️ ✔️ ❌ ❎ ➕ ➖ ❓ ❔ ❗ ❕ ‼️ ⁉️ ⚠️ 🚫 ⛔ 💯 🔥 ⭐ 🌟 ✨ ⚡ 💡 🔦 🕯️ 📌 📍 🎯 🏁 🚩 🔴 🟠 🟡 🟢 🔵 🟣 ⚪ ⚫ 🔺 🔻 ⬆️ ➡️ ⬇️ ⬅️ ↗️ 🔄 🆕 🆗 🆒 💬 💭 🗯️'.split(' ') },
  { id: 'objects', en: 'Work & home', vi: 'Công việc & nhà', items: '📝 📐 📏 ✏️ 🖊️ 🖍️ 🎨 🖼️ 📷 📸 💻 🖥️ 📱 📅 🗓️ ⏰ ⏳ 📦 📁 📎 🔑 🏠 🏢 🏛️ 🏗️ 🛋️ 🛏️ 🪑 🚪 🪟 🪞 🛁 🚿 🧱 🔧 🔨 🛠️ 🪜 🔌 🔋 💰 💳 ☕ 🍵 🧋 🎁 🎉 🎈 🏆 🥇'.split(' ') },
  { id: 'nature', en: 'Nature', vi: 'Thiên nhiên', items: '☀️ 🌤️ ⛅ 🌥️ ☁️ 🌧️ ⛈️ 🌩️ 🌈 🌙 🌛 🌝 🌚 ⭐ 🌌 🌅 🌄 🌇 🌆 🏙️ 🌃 🌲 🌳 🌴 🌵 🌿 🍀 🍃 🍂 🍁 🌸 🌺 🌻 🌹 🌷 🌼 💐 🪴 🌊 ❄️ 🔥'.split(' ') },
  { id: 'animals', en: 'Animals', vi: 'Con vật', items: '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🐤 🦆 🦉 🦄 🐝 🦋 🐌 🐞 🐢 🐙 🐬 🐳 🦭 🐠 🦔 🦥'.split(' ') },
];

export const STAMPS: Array<{ en: string; vi: string; color: string }> = [
  { en: 'APPROVED', vi: 'DUYỆT', color: '#2f9e44' },
  { en: 'REVISE', vi: 'SỬA LẠI', color: '#e8590c' },
  { en: 'IDEA', vi: 'Ý TƯỞNG', color: '#1971c2' },
  { en: 'CHECK ON SITE', vi: 'KIỂM TRA', color: '#9c36b5' },
  { en: 'PRIORITY', vi: 'ƯU TIÊN', color: '#e03131' },
  { en: 'DONE', vi: 'XONG', color: '#495057' },
];

/** Colour-temperature swatches — useful on lighting moodboards. */
export const CCT_SWATCHES = [
  { label: '1800 K', color: '#ff8a3d' },
  { label: '2200 K', color: '#ffa65c' },
  { label: '2700 K', color: '#ffbe7d' },
  { label: '3000 K', color: '#ffcf99' },
  { label: '3500 K', color: '#ffdcb4' },
  { label: '4000 K', color: '#ffe8cf' },
  { label: '5000 K', color: '#fff4ea' },
  { label: '6500 K', color: '#f2f5ff' },
];

type Sk = Record<string, unknown>;

const note = (x: number, y: number, fill: string, edge: string, text: string, w = 200, h = 140): Sk => ({
  type: 'rectangle',
  x,
  y,
  width: w,
  height: h,
  backgroundColor: fill,
  strokeColor: edge,
  fillStyle: 'solid',
  strokeWidth: 1,
  roughness: 0,
  roundness: { type: 3 },
  label: { text, fontSize: 18, fontFamily: 2, strokeColor: '#1e1e1e' },
});

const heading = (x: number, y: number, text: string, size = 28): Sk => ({
  type: 'text',
  x,
  y,
  text,
  fontSize: size,
  fontFamily: 2,
  strokeColor: '#1e1e1e',
});

/** Templates, as Excalidraw element skeletons positioned from (0, 0). */
export function templates(vi: boolean) {
  const t = (en: string, v: string) => (vi ? v : en);
  return [
    {
      id: 'moodboard',
      name: t('Lighting moodboard', 'Moodboard chiếu sáng'),
      build: (): Sk[] => [
        heading(0, -60, t('Lighting moodboard', 'Moodboard chiếu sáng'), 34),
        ...[
          t('Atmosphere', 'Không khí'),
          t('Materials & textures', 'Vật liệu & bề mặt'),
          t('Fixtures', 'Bộ đèn'),
          t('References', 'Tham khảo'),
        ].map((name, i) => ({
          type: 'frame',
          x: (i % 2) * 520,
          y: Math.floor(i / 2) * 420,
          width: 480,
          height: 380,
          name,
        })),
        ...CCT_SWATCHES.map((s, i) => ({
          type: 'rectangle',
          x: i * 124,
          y: 880,
          width: 110,
          height: 70,
          backgroundColor: s.color,
          strokeColor: '#adb5bd',
          fillStyle: 'solid',
          roughness: 0,
          roundness: { type: 3 },
          label: { text: s.label, fontSize: 16, fontFamily: 2 },
        })),
      ],
    },
    {
      id: 'layers',
      name: t('Lighting concept (layers)', 'Ý tưởng chiếu sáng (các lớp)'),
      build: (): Sk[] => {
        const cols = [
          [t('Ambient', 'Chiếu sáng nền'), '#c5e3ff', '#3b82d6'],
          [t('Task', 'Chiếu sáng làm việc'), '#c3f0c8', '#40a35a'],
          [t('Accent', 'Điểm nhấn'), '#fff2a8', '#e6c84f'],
          [t('Decorative', 'Trang trí'), '#ffc9de', '#e64980'],
          [t('Controls & scenes', 'Điều khiển & cảnh'), '#e5d4ff', '#8458d6'],
        ];
        return [
          heading(0, -70, t('Lighting concept', 'Ý tưởng chiếu sáng'), 34),
          ...cols.flatMap(([name, fill, edge], i) => [
            heading(i * 240, 0, name, 22),
            note(i * 240, 50, fill, edge, t('Intent…', 'Ý đồ…')),
            note(i * 240, 210, fill, edge, t('Fixtures / CCT…', 'Đèn / CCT…')),
          ]),
        ];
      },
    },
    {
      id: 'rcp',
      name: t('Ceiling plan sheet', 'Bản vẽ mặt bằng trần'),
      build: (): Sk[] => [
        { type: 'frame', x: 0, y: 0, width: 900, height: 620, name: t('Reflected ceiling plan', 'Mặt bằng trần') },
        { type: 'rectangle', x: 40, y: 60, width: 600, height: 500, strokeColor: '#1e1e1e', strokeWidth: 2, roughness: 0 },
        heading(670, 60, t('Legend', 'Chú giải'), 22),
        heading(670, 100, t('◉  Downlight\n⊗  Pendant\n▬  Linear\n●—●  Track\n- - -  Cove / LED strip', '◉  Downlight\n⊗  Đèn thả\n▬  Đèn tuyến tính\n●—●  Đèn ray\n- - -  Hắt trần / LED dây'), 16),
        heading(670, 300, t('Notes', 'Ghi chú'), 22),
        note(670, 340, '#fff2a8', '#e6c84f', t('Ceiling height…\nTarget lux…', 'Cao độ trần…\nĐộ rọi mục tiêu…'), 200, 160),
      ],
    },
  ];
}
