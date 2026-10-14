import { expect, test } from "bun:test"
import { Resvg } from "@resvg/resvg-js"
import {
  type AnyCircuitElement,
  type PcbCourtyardPolygon,
  pcb_courtyard_polygon,
} from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "lib"
import { getComprehensivePcbBounds } from "lib/pcb/get-pcb-bounds-from-circuit-json"
import { parse, stringify } from "svgson"
const noPadding = {
  width: 800,
  height: 600,
  drawPaddingOutsideBoard: false,
  showCourtyards: true,
}
const makePolygon = (options: Partial<PcbCourtyardPolygon> = {}) =>
  pcb_courtyard_polygon.parse({
    type: "pcb_courtyard_polygon",
    pcb_courtyard_polygon_id: "polygon",
    pcb_component_id: "component",
    points: [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 2 },
      { x: 0, y: 2 },
    ],
    layer: "top",
    ...options,
  })
const extents = (element: PcbCourtyardPolygon) => {
  const b = getComprehensivePcbBounds([element])
  return [b.minX, b.maxX, b.minY, b.maxY]
}
function expectNearBounds(element: PcbCourtyardPolygon, expected: number[]) {
  const actual = extents(element)
  for (const [index, value] of expected.entries())
    expect(actual[index]).toBeCloseTo(value, 10)
}
async function measure(svg: string) {
  const tree = await parse(svg)
  tree.children = tree.children.filter(
    (n) => n.attributes["data-type"] === "pcb_courtyard_polygon",
  )
  const count = tree.children.length
  const attributes = tree.children[0]?.attributes
  tree.attributes = {
    ...tree.attributes,
    width: "400",
    height: "350",
    viewBox: "-400 -400 1600 1400",
  }
  const pixels = new Resvg(stringify(tree)).render().pixels
  let crop = 0
  let visible = 0
  // 元viewBoxを維持し、小さなバッファで範囲外の実描画を検出します。
  for (let y = 0; y < 350; y++)
    for (let x = 0; x < 400; x++)
      if (pixels[(y * 400 + x) * 4 + 3]) {
        if (x < 100 || x >= 300 || y < 100 || y >= 250) crop++
        else visible++
      }
  return { count, attributes, crop, visible }
}
const shapes = {
  rect: [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 2 },
    { x: 0, y: 2 },
  ],
  triangle: [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 2, y: 2 },
  ],
  concave: [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 2 },
    { x: 2, y: 1 },
    { x: 0, y: 2 },
  ],
  crossed: [
    { x: 0, y: 0 },
    { x: 4, y: 2 },
    { x: 4, y: 0 },
    { x: 0, y: 2 },
  ],
}
for (const [name, points] of Object.entries(shapes))
  for (const offset of [
    { x: 0, y: 0 },
    { x: 2, y: -3 },
  ])
    for (const reverse of [false, true])
      for (const layer of ["top", "bottom"] as const)
        test(`polygon stroke fits ${name} ${offset.x} ${reverse} ${layer}`, async () => {
          const vertices = points.map((p) => ({
            x: p.x + offset.x,
            y: p.y + offset.y,
          }))
          if (reverse) vertices.reverse()
          const polygon = makePolygon({ points: vertices, layer })
          const before = structuredClone(polygon)
          const pixels = await measure(
            convertCircuitJsonToPcbSvg([polygon], { ...noPadding, layer }),
          )
          expect(pixels.count).toBe(1)
          expect(pixels.crop).toBe(0)
          expect(pixels.visible).toBeGreaterThan(0)
          expect(pixels.attributes?.["stroke-linejoin"]).toBe("round")
          expect(polygon).toEqual(before)
        })
test("fixed half stroke has independent rectangle bounds", () =>
  expectNearBounds(makePolygon(), [-0.025, 4.025, -0.025, 2.025]))
test("reversed triangle retains the same painted exterior", () =>
  expectNearBounds(
    makePolygon({ points: [...shapes.triangle].reverse() }),
    [-0.025, 4.025, -0.025, 2.025],
  ))
const pad = {
  type: "pcb_smtpad",
  pcb_smtpad_id: "pad",
  pcb_component_id: "component",
  shape: "rect",
  x: 0,
  y: 0,
  width: 2,
  height: 2,
  layer: "top",
} as AnyCircuitElement
for (const points of [
  [],
  [{ x: 0, y: 0 }],
  [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ],
])
  test(`empty or coincident control has ${points.length} vertices`, async () => {
    const polygon = { ...makePolygon(), points }
    expect(pcb_courtyard_polygon.safeParse(polygon).success).toBe(
      points.length >= 3,
    )
    expect(getComprehensivePcbBounds([polygon]).hasBounds).toBe(
      points.length > 0,
    )
    if (points.length > 0) expect(extents(polygon)).toEqual([0, 0, 0, 0])
    const pixels = await measure(
      convertCircuitJsonToPcbSvg([pad, polygon], noPadding),
    )
    expect(pixels.count).toBe(points.length === 0 ? 0 : 1)
    expect(pixels.visible).toBe(0)
    expect(pixels.crop).toBe(0)
  })
test("raw two-vertex polygon remains visible with rounded turning points", async () => {
  const polygon = {
    ...makePolygon(),
    points: [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ],
  }
  expect(pcb_courtyard_polygon.safeParse(polygon).success).toBe(false)
  expectNearBounds(polygon, [-0.025, 4.025, -0.025, 0.025])
  const pixels = await measure(convertCircuitJsonToPcbSvg([polygon], noPadding))
  expect(pixels.crop).toBe(0)
  expect(pixels.visible).toBeGreaterThan(0)
})
test("schema-valid collinear polygon retains its visible stroke", async () => {
  const polygon = makePolygon({
    points: [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 4, y: 0 },
    ],
  })
  expectNearBounds(polygon, [-0.025, 4.025, -0.025, 0.025])
  const pixels = await measure(convertCircuitJsonToPcbSvg([polygon], noPadding))
  expect(pixels.crop).toBe(0)
  expect(pixels.visible).toBeGreaterThan(0)
})
for (const points of [undefined, null])
  test(`missing points retains exception ${points}`, () =>
    expect(() =>
      extents({ ...makePolygon(), points } as unknown as PcbCourtyardPolygon),
    ).toThrow())
for (const x of [undefined, null, Number.NaN, Symbol("point")])
  test(`malformed point retains exception ${String(x)}`, () =>
    expect(() =>
      extents({
        ...makePolygon(),
        points: [
          { x, y: 0 },
          { x: 4, y: 0 },
          { x: 2, y: 2 },
        ],
      } as unknown as PcbCourtyardPolygon),
    ).toThrow())
test("invalid unit text retains nominal NaN bounds", () =>
  expect(
    extents({
      ...makePolygon(),
      points: [
        { x: "invalid", y: 0 },
        { x: 4, y: 0 },
        { x: 2, y: 2 },
      ],
    } as unknown as PcbCourtyardPolygon),
  ).toEqual([Number.NaN, Number.NaN, 0, 2]))
test("raw unit coordinates keep parsed nominal bounds", () =>
  expect(
    extents({
      ...makePolygon(),
      points: [
        { x: "0mm", y: "0mm" },
        { x: "4mm", y: "0mm" },
        { x: "2mm", y: "2mm" },
      ],
    } as unknown as PcbCourtyardPolygon),
  ).toEqual([0, 4, 0, 2]))
test("parsed units include the visible fixed stroke", async () => {
  const polygon = pcb_courtyard_polygon.parse({
    ...makePolygon(),
    points: [
      { x: "0mm", y: "0mm" },
      { x: "4mm", y: "0mm" },
      { x: "2mm", y: "2mm" },
    ],
  })
  expectNearBounds(polygon, [-0.025, 4.025, -0.025, 2.025])
  const pixels = await measure(convertCircuitJsonToPcbSvg([polygon], noPadding))
  expect(pixels.crop).toBe(0)
  expect(pixels.visible).toBeGreaterThan(0)
})
test("infinite point keeps nominal bounds without extending finite axes", () =>
  expect(
    extents({
      ...makePolygon(),
      points: [
        { x: Number.POSITIVE_INFINITY, y: 0 },
        { x: 4, y: 0 },
        { x: 2, y: 2 },
      ],
    }),
  ).toEqual([2, Number.POSITIVE_INFINITY, 0, 2]))
test("maximum finite coordinates avoid overflowing midpoint arithmetic", () =>
  expect(
    extents(
      makePolygon({
        points: [
          { x: Number.MAX_VALUE, y: 0 },
          { x: Number.MAX_VALUE, y: 2 },
          { x: Number.MAX_VALUE, y: 1 },
        ],
      }),
    ),
  ).toEqual([Number.MAX_VALUE, Number.MAX_VALUE, -0.025, 2.025]))
for (const showCourtyards of [undefined, false])
  test(`hidden polygon does not resize the pad ${showCourtyards}`, async () => {
    const polygon = makePolygon({
      points: shapes.rect.map((p) => ({ x: p.x + 8, y: p.y + 3 })),
    })
    const options = { ...noPadding, showCourtyards }
    expect(convertCircuitJsonToPcbSvg([pad, polygon], options)).toBe(
      convertCircuitJsonToPcbSvg([pad], options),
    )
    const pixels = await measure(
      convertCircuitJsonToPcbSvg([pad, polygon], options),
    )
    expect(pixels.count).toBe(0)
    expect(pixels.visible).toBe(0)
  })
for (const layer of ["top", "bottom"] as const) {
  test(`custom courtyard color stays visible ${layer}`, async () => {
    const pixels = await measure(
      convertCircuitJsonToPcbSvg([makePolygon({ layer })], {
        ...noPadding,
        layer,
        colorOverrides: { courtyard: { top: "#00aa66", bottom: "#9955ff" } },
      }),
    )
    expect(pixels.attributes?.stroke).toBe(
      layer === "top" ? "#00aa66" : "#9955ff",
    )
    expect(pixels.attributes?.fill).toBe("none")
    expect(pixels.crop).toBe(0)
    expect(pixels.visible).toBeGreaterThan(0)
  })
  test(`mismatching layer stays invisible ${layer}`, async () => {
    const pixels = await measure(
      convertCircuitJsonToPcbSvg([makePolygon({ layer })], {
        ...noPadding,
        layer: layer === "top" ? "bottom" : "top",
      }),
    )
    expect(pixels.count).toBe(0)
    expect(pixels.visible).toBe(0)
  })
}
test("element color overrides layer map", async () => {
  const pixels = await measure(
    convertCircuitJsonToPcbSvg([makePolygon({ color: "#ff8800" })], {
      ...noPadding,
      colorOverrides: { courtyard: { top: "#00aa66" } },
    }),
  )
  expect(pixels.attributes?.stroke).toBe("#ff8800")
  expect(pixels.crop).toBe(0)
  expect(pixels.visible).toBeGreaterThan(0)
})
test("raw undefined layer stays top", async () => {
  const pixels = await measure(
    convertCircuitJsonToPcbSvg(
      [
        {
          ...makePolygon(),
          layer: undefined,
        } as unknown as PcbCourtyardPolygon,
      ],
      { ...noPadding, layer: "top" },
    ),
  )
  expect(pixels.count).toBe(1)
  expect(pixels.attributes?.["data-pcb-layer"]).toBe("top")
  expect(pixels.crop).toBe(0)
  expect(pixels.visible).toBeGreaterThan(0)
})
test("frozen vertices and input stay unchanged", async () => {
  const vertices = makePolygon().points.map((p) => Object.freeze({ ...p }))
  Object.freeze(vertices)
  const polygon = Object.freeze({ ...makePolygon(), points: vertices })
  const before = structuredClone(polygon)
  const pixels = await measure(convertCircuitJsonToPcbSvg([polygon], noPadding))
  expect(polygon).toEqual(before)
  expect(pixels.crop).toBe(0)
  expect(pixels.visible).toBeGreaterThan(0)
})
test("explicit crop preserves intentional clipping", async () => {
  const pixels = await measure(
    convertCircuitJsonToPcbSvg([makePolygon()], {
      ...noPadding,
      viewport: { minX: 0, maxX: 4, minY: 0, maxY: 2 },
    }),
  )
  expect(pixels.crop).toBeGreaterThan(0)
  expect(pixels.visible).toBeGreaterThan(0)
})
test("default padding encloses polygon", async () => {
  const pixels = await measure(
    convertCircuitJsonToPcbSvg([makePolygon()], {
      width: 800,
      height: 600,
      showCourtyards: true,
    }),
  )
  expect(pixels.crop).toBe(0)
  expect(pixels.visible).toBeGreaterThan(0)
})
for (const [name, options] of Object.entries({
  rect: {},
  concave: { points: shapes.concave },
  bottom: { layer: "bottom" as const },
}))
  test(`polygon stroke snapshot ${name}`, () => {
    const polygon = makePolygon(options)
    expect(
      convertCircuitJsonToPcbSvg([polygon], {
        ...noPadding,
        layer: polygon.layer,
      }),
    ).toMatchSvgSnapshot(`${import.meta.path}-${name}`)
  })
test("hidden polygon snapshot retains pad camera", () =>
  expect(
    convertCircuitJsonToPcbSvg(
      [
        pad,
        makePolygon({
          points: shapes.rect.map((p) => ({ x: p.x + 8, y: p.y + 3 })),
        }),
      ],
      { ...noPadding, showCourtyards: false },
    ),
  ).toMatchSvgSnapshot(`${import.meta.path}-hidden`))
test("physical board and automatic camera remain nominal", () => {
  const board = {
    type: "pcb_board",
    pcb_board_id: "board",
    center: { x: 2, y: 1 },
    width: 4,
    height: 2,
  } as AnyCircuitElement
  const b = getComprehensivePcbBounds([board, makePolygon()])
  expect([b.boardMinX, b.boardMaxX, b.boardMinY, b.boardMaxY]).toEqual([
    0, 4, 0, 2,
  ])
  expect(convertCircuitJsonToPcbSvg([board, makePolygon()], noPadding)).toBe(
    convertCircuitJsonToPcbSvg([board, makePolygon()], {
      ...noPadding,
      viewport: { minX: 0, maxX: 4, minY: 0, maxY: 2 },
    }),
  )
})
test("physical pad and courtyard outline stay nominal", () => {
  const p = getComprehensivePcbBounds([pad])
  expect([p.minX, p.maxX, p.minY, p.maxY]).toEqual([-1, 1, -1, 1])
  const outline = {
    type: "pcb_courtyard_outline",
    pcb_courtyard_outline_id: "outline",
    pcb_component_id: "component",
    layer: "top",
    outline: shapes.rect,
  } as AnyCircuitElement
  const b = getComprehensivePcbBounds([outline])
  expect([b.minX, b.maxX, b.minY, b.maxY]).toEqual([0, 4, 0, 2])
})
