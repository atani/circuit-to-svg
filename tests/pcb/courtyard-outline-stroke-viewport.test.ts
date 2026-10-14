import { expect, test } from "bun:test"
import { Resvg } from "@resvg/resvg-js"
import {
  type AnyCircuitElement,
  type PcbCourtyardOutline,
  pcb_courtyard_outline,
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
const makeOutline = (options: Partial<PcbCourtyardOutline> = {}) =>
  pcb_courtyard_outline.parse({
    type: "pcb_courtyard_outline",
    pcb_courtyard_outline_id: "outline",
    pcb_component_id: "component",
    outline: [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 2 },
      { x: 0, y: 2 },
    ],
    layer: "top",
    ...options,
  })
const extents = (element: PcbCourtyardOutline) => {
  const b = getComprehensivePcbBounds([element])
  return [b.minX, b.maxX, b.minY, b.maxY]
}
function expectNearBounds(element: PcbCourtyardOutline, expected: number[]) {
  const actual = extents(element)
  for (const [index, value] of expected.entries())
    expect(actual[index]).toBeCloseTo(value, 10)
}
async function measure(svg: string) {
  const tree = await parse(svg)
  tree.children = tree.children.filter(
    (n) => n.attributes["data-type"] === "pcb_courtyard_outline",
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
for (const [name, shapePoints] of Object.entries(shapes))
  for (const offset of [
    { x: 0, y: 0 },
    { x: 2, y: -3 },
  ])
    for (const reverse of [false, true])
      for (const layer of ["top", "bottom"] as const)
        test(`outline stroke fits ${name} ${offset.x} ${reverse} ${layer}`, async () => {
          const vertices = shapePoints.map((p) => ({
            x: p.x + offset.x,
            y: p.y + offset.y,
          }))
          if (reverse) vertices.reverse()
          const outline = makeOutline({ outline: vertices, layer })
          const before = structuredClone(outline)
          const pixels = await measure(
            convertCircuitJsonToPcbSvg([outline], { ...noPadding, layer }),
          )
          expect(pixels.count).toBe(1)
          expect(pixels.crop).toBe(0)
          expect(pixels.visible).toBeGreaterThan(0)
          expect(pixels.attributes?.["stroke-linejoin"]).toBe("round")
          expect(outline).toEqual(before)
        })
test("fixed half stroke has independent rectangle bounds", () =>
  expectNearBounds(makeOutline(), [-0.025, 4.025, -0.025, 2.025]))
test("reversed triangle retains the same painted exterior", () =>
  expectNearBounds(
    makeOutline({ outline: [...shapes.triangle].reverse() }),
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
for (const vertices of [
  [],
  [{ x: 0, y: 0 }],
  [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ],
  [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ],
])
  test(`empty or coincident control has ${vertices.length} vertices`, async () => {
    const outline = { ...makeOutline(), outline: vertices }
    expect(pcb_courtyard_outline.safeParse(outline).success).toBe(
      vertices.length >= 2,
    )
    expect(getComprehensivePcbBounds([outline]).hasBounds).toBe(
      vertices.length > 0,
    )
    if (vertices.length > 0) expect(extents(outline)).toEqual([0, 0, 0, 0])
    const pixels = await measure(
      convertCircuitJsonToPcbSvg([pad, outline], noPadding),
    )
    expect(pixels.count).toBe(vertices.length === 0 ? 0 : 1)
    expect(pixels.visible).toBe(0)
    expect(pixels.crop).toBe(0)
  })
test("schema-valid two-vertex outline retains its visible closed stroke", async () => {
  const outline = {
    ...makeOutline(),
    outline: [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ],
  }
  expect(pcb_courtyard_outline.safeParse(outline).success).toBe(true)
  expectNearBounds(outline, [-0.025, 4.025, -0.025, 0.025])
  const pixels = await measure(convertCircuitJsonToPcbSvg([outline], noPadding))
  expect(pixels.crop).toBe(0)
  expect(pixels.visible).toBeGreaterThan(0)
})
test("schema-valid collinear outline retains its visible stroke", async () => {
  const outline = makeOutline({
    outline: [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 4, y: 0 },
    ],
  })
  expectNearBounds(outline, [-0.025, 4.025, -0.025, 0.025])
  const pixels = await measure(convertCircuitJsonToPcbSvg([outline], noPadding))
  expect(pixels.crop).toBe(0)
  expect(pixels.visible).toBeGreaterThan(0)
})
for (const outline of [undefined, null])
  test(`missing outline retains exception ${outline}`, () =>
    expect(() =>
      extents({ ...makeOutline(), outline } as unknown as PcbCourtyardOutline),
    ).toThrow())
for (const x of [undefined, null, Number.NaN, Symbol("point")])
  test(`malformed point retains exception ${String(x)}`, () =>
    expect(() =>
      extents({
        ...makeOutline(),
        outline: [
          { x, y: 0 },
          { x: 4, y: 0 },
          { x: 2, y: 2 },
        ],
      } as unknown as PcbCourtyardOutline),
    ).toThrow())
test("invalid unit text retains nominal NaN bounds", () =>
  expect(
    extents({
      ...makeOutline(),
      outline: [
        { x: "invalid", y: 0 },
        { x: 4, y: 0 },
        { x: 2, y: 2 },
      ],
    } as unknown as PcbCourtyardOutline),
  ).toEqual([Number.NaN, Number.NaN, 0, 2]))
test("raw unit coordinates keep parsed nominal bounds", () =>
  expect(
    extents({
      ...makeOutline(),
      outline: [
        { x: "0mm", y: "0mm" },
        { x: "4mm", y: "0mm" },
        { x: "2mm", y: "2mm" },
      ],
    } as unknown as PcbCourtyardOutline),
  ).toEqual([0, 4, 0, 2]))
test("parsed units include the visible fixed stroke", async () => {
  const outline = pcb_courtyard_outline.parse({
    ...makeOutline(),
    outline: [
      { x: "0mm", y: "0mm" },
      { x: "4mm", y: "0mm" },
      { x: "2mm", y: "2mm" },
    ],
  })
  expectNearBounds(outline, [-0.025, 4.025, -0.025, 2.025])
  const pixels = await measure(convertCircuitJsonToPcbSvg([outline], noPadding))
  expect(pixels.crop).toBe(0)
  expect(pixels.visible).toBeGreaterThan(0)
})
test("infinite point keeps nominal bounds without extending finite axes", () =>
  expect(
    extents({
      ...makeOutline(),
      outline: [
        { x: Number.POSITIVE_INFINITY, y: 0 },
        { x: 4, y: 0 },
        { x: 2, y: 2 },
      ],
    }),
  ).toEqual([2, Number.POSITIVE_INFINITY, 0, 2]))
test("maximum finite coordinates avoid overflowing midpoint arithmetic", () =>
  expect(
    extents(
      makeOutline({
        outline: [
          { x: Number.MAX_VALUE, y: 0 },
          { x: Number.MAX_VALUE, y: 2 },
          { x: Number.MAX_VALUE, y: 1 },
        ],
      }),
    ),
  ).toEqual([Number.MAX_VALUE, Number.MAX_VALUE, -0.025, 2.025]))
for (const showCourtyards of [undefined, false])
  test(`hidden outline does not resize the pad ${showCourtyards}`, async () => {
    const outline = makeOutline({
      outline: shapes.rect.map((p) => ({ x: p.x + 8, y: p.y + 3 })),
    })
    const options = { ...noPadding, showCourtyards }
    expect(convertCircuitJsonToPcbSvg([pad, outline], options)).toBe(
      convertCircuitJsonToPcbSvg([pad], options),
    )
    const pixels = await measure(
      convertCircuitJsonToPcbSvg([pad, outline], options),
    )
    expect(pixels.count).toBe(0)
    expect(pixels.visible).toBe(0)
  })
for (const layer of ["top", "bottom"] as const) {
  test(`custom courtyard color stays visible ${layer}`, async () => {
    const pixels = await measure(
      convertCircuitJsonToPcbSvg([makeOutline({ layer })], {
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
      convertCircuitJsonToPcbSvg([makeOutline({ layer })], {
        ...noPadding,
        layer: layer === "top" ? "bottom" : "top",
      }),
    )
    expect(pixels.count).toBe(0)
    expect(pixels.visible).toBe(0)
  })
}
test("raw element color stays ignored by the outline renderer", async () => {
  const pixels = await measure(
    convertCircuitJsonToPcbSvg(
      [{ ...makeOutline(), color: "#ff8800" } as PcbCourtyardOutline],
      {
        ...noPadding,
        colorOverrides: { courtyard: { top: "#00aa66" } },
      },
    ),
  )
  expect(pixels.attributes?.stroke).toBe("#00aa66")
  expect(pixels.crop).toBe(0)
  expect(pixels.visible).toBeGreaterThan(0)
})
test("raw undefined layer is excluded by a top layer filter", async () => {
  const raw = {
    ...makeOutline(),
    layer: undefined,
  } as unknown as PcbCourtyardOutline
  const pixels = await measure(
    convertCircuitJsonToPcbSvg([raw], { ...noPadding, layer: "top" }),
  )
  expect(pixels.count).toBe(0)
  expect(pixels.visible).toBe(0)
})
test("raw undefined layer uses top color without a layer filter", async () => {
  const raw = {
    ...makeOutline(),
    layer: undefined,
  } as unknown as PcbCourtyardOutline
  const pixels = await measure(
    convertCircuitJsonToPcbSvg([raw], {
      ...noPadding,
      colorOverrides: { courtyard: { top: "#00aa66" } },
    }),
  )
  expect(pixels.count).toBe(1)
  expect(pixels.attributes?.stroke).toBe("#00aa66")
  expect(pixels.crop).toBe(0)
  expect(pixels.visible).toBeGreaterThan(0)
})
test("frozen vertices and input stay unchanged", async () => {
  const vertices = makeOutline().outline.map((p) => Object.freeze({ ...p }))
  Object.freeze(vertices)
  const outline = Object.freeze({ ...makeOutline(), outline: vertices })
  const before = structuredClone(outline)
  const pixels = await measure(convertCircuitJsonToPcbSvg([outline], noPadding))
  expect(outline).toEqual(before)
  expect(pixels.crop).toBe(0)
  expect(pixels.visible).toBeGreaterThan(0)
})
test("explicit crop preserves intentional clipping", async () => {
  const pixels = await measure(
    convertCircuitJsonToPcbSvg([makeOutline()], {
      ...noPadding,
      viewport: { minX: 0, maxX: 4, minY: 0, maxY: 2 },
    }),
  )
  expect(pixels.crop).toBeGreaterThan(0)
  expect(pixels.visible).toBeGreaterThan(0)
})
test("default padding encloses outline", async () => {
  const pixels = await measure(
    convertCircuitJsonToPcbSvg([makeOutline()], {
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
  concave: { outline: shapes.concave },
  bottom: { layer: "bottom" as const },
}))
  test(`outline stroke snapshot ${name}`, () => {
    const outline = makeOutline(options)
    expect(
      convertCircuitJsonToPcbSvg([outline], {
        ...noPadding,
        layer: outline.layer,
      }),
    ).toMatchSvgSnapshot(`${import.meta.path}-${name}`)
  })
test("hidden outline snapshot retains pad camera", () =>
  expect(
    convertCircuitJsonToPcbSvg(
      [
        pad,
        makeOutline({
          outline: shapes.rect.map((p) => ({ x: p.x + 8, y: p.y + 3 })),
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
  const b = getComprehensivePcbBounds([board, makeOutline()])
  expect([b.boardMinX, b.boardMaxX, b.boardMinY, b.boardMaxY]).toEqual([
    0, 4, 0, 2,
  ])
  expect(convertCircuitJsonToPcbSvg([board, makeOutline()], noPadding)).toBe(
    convertCircuitJsonToPcbSvg([board, makeOutline()], {
      ...noPadding,
      viewport: { minX: 0, maxX: 4, minY: 0, maxY: 2 },
    }),
  )
})
test("physical pad stays nominal and polygon retains stroke bounds", () => {
  const p = getComprehensivePcbBounds([pad])
  expect([p.minX, p.maxX, p.minY, p.maxY]).toEqual([-1, 1, -1, 1])
  const polygon = {
    type: "pcb_courtyard_polygon",
    pcb_courtyard_polygon_id: "polygon",
    pcb_component_id: "component",
    layer: "top",
    points: shapes.rect,
  } as AnyCircuitElement
  const b = getComprehensivePcbBounds([polygon])
  expect([b.minX, b.maxX, b.minY, b.maxY]).toEqual([
    -0.025, 4.025, -0.025, 2.025,
  ])
})
