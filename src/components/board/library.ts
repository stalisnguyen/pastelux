/*
 * Lighting symbols for quick reflected-ceiling and section sketches. Shown in
 * Excalidraw's library panel; drag one onto the board to place it. Simple,
 * widely read conventions — not tied to any one office's legend.
 */

type Skeleton = Record<string, unknown>;
type Convert = (skeletons: any[], opts?: any) => any[];

const INK = '#1e1e1e';
const LAMP = '#ffd43b';

const label = (text: string, y: number): Skeleton => ({
  type: 'text',
  x: 0,
  y,
  text,
  fontSize: 12,
  fontFamily: 2,
  strokeColor: '#868e96',
});

const SYMBOLS: Array<{ name: string; shapes: Skeleton[] }> = [
  {
    name: 'Downlight',
    shapes: [
      { type: 'ellipse', x: 0, y: 0, width: 36, height: 36, strokeColor: INK, strokeWidth: 2 },
      { type: 'ellipse', x: 11, y: 11, width: 14, height: 14, strokeColor: INK, backgroundColor: LAMP, fillStyle: 'solid' },
      label('Downlight', 44),
    ],
  },
  {
    name: 'Adjustable spot',
    shapes: [
      { type: 'ellipse', x: 0, y: 0, width: 36, height: 36, strokeColor: INK, strokeWidth: 2, backgroundColor: LAMP, fillStyle: 'hachure' },
      { type: 'arrow', x: 18, y: 18, points: [[0, 0], [30, -18]], strokeColor: INK, strokeWidth: 2 },
      label('Adjustable spot', 44),
    ],
  },
  {
    name: 'Pendant',
    shapes: [
      { type: 'ellipse', x: 0, y: 0, width: 36, height: 36, strokeColor: INK, strokeWidth: 2 },
      { type: 'line', x: 6, y: 6, points: [[0, 0], [24, 24]], strokeColor: INK, strokeWidth: 2 },
      { type: 'line', x: 30, y: 6, points: [[0, 0], [-24, 24]], strokeColor: INK, strokeWidth: 2 },
      label('Pendant', 44),
    ],
  },
  {
    name: 'Wall washer',
    shapes: [
      { type: 'ellipse', x: 0, y: 0, width: 36, height: 36, strokeColor: INK, strokeWidth: 2 },
      { type: 'line', x: 44, y: -6, points: [[0, 0], [0, 48]], strokeColor: INK, strokeWidth: 3 },
      { type: 'arrow', x: 36, y: 18, points: [[0, 0], [6, 0]], strokeColor: INK, strokeWidth: 2 },
      label('Wall washer', 50),
    ],
  },
  {
    name: 'Linear',
    shapes: [
      { type: 'rectangle', x: 0, y: 0, width: 180, height: 14, strokeColor: INK, strokeWidth: 2, backgroundColor: LAMP, fillStyle: 'solid' },
      label('Linear', 22),
    ],
  },
  {
    name: 'Track + spots',
    shapes: [
      { type: 'line', x: 0, y: 10, points: [[0, 0], [200, 0]], strokeColor: INK, strokeWidth: 4 },
      { type: 'ellipse', x: 30, y: 0, width: 20, height: 20, strokeColor: INK, backgroundColor: LAMP, fillStyle: 'solid' },
      { type: 'ellipse', x: 90, y: 0, width: 20, height: 20, strokeColor: INK, backgroundColor: LAMP, fillStyle: 'solid' },
      { type: 'ellipse', x: 150, y: 0, width: 20, height: 20, strokeColor: INK, backgroundColor: LAMP, fillStyle: 'solid' },
      label('Track + spots', 28),
    ],
  },
  {
    name: 'Cove / LED strip',
    shapes: [
      { type: 'rectangle', x: 0, y: 0, width: 200, height: 10, strokeColor: INK, strokeStyle: 'dashed', strokeWidth: 2 },
      label('Cove / LED strip', 18),
    ],
  },
  {
    name: 'Inground uplight',
    shapes: [
      { type: 'diamond', x: 0, y: 0, width: 36, height: 36, strokeColor: INK, strokeWidth: 2, backgroundColor: LAMP, fillStyle: 'solid' },
      label('Inground uplight', 44),
    ],
  },
  {
    name: 'Bollard',
    shapes: [
      { type: 'rectangle', x: 0, y: 0, width: 24, height: 24, strokeColor: INK, strokeWidth: 2 },
      { type: 'ellipse', x: 6, y: 6, width: 12, height: 12, strokeColor: INK, backgroundColor: LAMP, fillStyle: 'solid' },
      label('Bollard', 32),
    ],
  },
  {
    name: 'Note',
    shapes: [
      {
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 160,
        height: 110,
        strokeColor: '#e9c46a',
        backgroundColor: '#fff3bf',
        fillStyle: 'solid',
        label: { text: 'Note', fontSize: 16 },
      },
    ],
  },
];

export function lightingLibrary(convert: Convert) {
  const now = Date.now();
  return SYMBOLS.map((sym, i) => {
    const groupId = `pastelux-sym-${i}`;
    const elements = convert(sym.shapes).map((el: any) => ({ ...el, groupIds: [groupId] }));
    return { id: `pastelux-${i}`, status: 'published' as const, name: sym.name, created: now, elements };
  });
}
