import { expect, test } from "bun:test"
import { Resvg } from "@resvg/resvg-js"
import {
  type AnyCircuitElement,
  type PcbCourtyardCircle,
  pcb_courtyard_circle,
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
const makeCircle = (options: Partial<PcbCourtyardCircle> = {}) =>
  pcb_courtyard_circle.parse({
    type: "pcb_courtyard_circle",
    pcb_courtyard_circle_id: "circle",
    pcb_component_id: "component",
    center: { x: 2, y: -3 },
    radius: 1,
    layer: "top",
    ...options,
  })
const extents = (element: PcbCourtyardCircle) => {
  const b = getComprehensivePcbBounds([element])
  return [b.minX, b.maxX, b.minY, b.maxY]
}
function expectNearBounds(element: PcbCourtyardCircle, expected: number[]) {
  const actual = extents(element)
  for (const [index, value] of expected.entries())
    expect(actual[index]).toBeCloseTo(value, 10)
}
async function measure(svg: string) {
  const tree = await parse(svg)
  tree.children = tree.children.filter(
    (n) => n.attributes["data-type"] === "pcb_courtyard_circle",
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
for (const center of [
  { x: 0, y: 0 },
  { x: 2, y: -3 },
])
  for (const radius of [0.001, 0.1, 1, 2])
    for (const layer of ["top", "bottom"] as const)
      test(`circle stroke fits ${center.x} ${radius} ${layer}`, async () => {
        const circle = makeCircle({ center, radius, layer })
        const before = structuredClone(circle)
        const pixels = await measure(
          convertCircuitJsonToPcbSvg([circle], { ...noPadding, layer }),
        )
        expect(pixels.count).toBe(1)
        expect(pixels.crop).toBe(0)
        expect(pixels.visible).toBeGreaterThan(0)
        expect(pixels.attributes?.fill).toBe("none")
        expect(circle).toEqual(before)
      })
test("fixed half stroke has independent numeric bounds", () =>
  expectNearBounds(makeCircle(), [0.975, 3.025, -4.025, -1.975]))
test("tiny positive radius retains its visible outer stroke", () =>
  expectNearBounds(
    makeCircle({ radius: 0.001 }),
    [1.974, 2.026, -3.026, -2.974],
  ))
for (const layer of ["top", "bottom"] as const)
  test(`zero radius stays invisible ${layer}`, async () => {
    const circle = makeCircle({ radius: 0, layer })
    expect(extents(circle)).toEqual([2, 2, -3, -3])
    const pixels = await measure(
      convertCircuitJsonToPcbSvg([circle], { ...noPadding, layer }),
    )
    expect(pixels.count).toBe(1)
    expect(pixels.crop).toBe(0)
    expect(pixels.visible).toBe(0)
  })
test("negative radius retains inverted legacy bounds", () =>
  expect(extents(makeCircle({ radius: -1 }))).toEqual([3, 1, -2, -4]))
for (const radius of [undefined, Number.NaN, "1mm", Symbol("radius")])
  test(`malformed radius preserves exception ${String(radius)}`, () =>
    expect(() =>
      extents({ ...makeCircle(), radius } as unknown as PcbCourtyardCircle),
    ).toThrow())
test("raw null radius retains point bounds", () =>
  expect(
    extents({ ...makeCircle(), radius: null } as unknown as PcbCourtyardCircle),
  ).toEqual([2, 2, -3, -3]))
test("infinite radius retains infinite bounds", () =>
  expect(
    extents({ ...makeCircle(), radius: Number.POSITIVE_INFINITY }),
  ).toEqual([
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ]))
test("maximum radius keeps overflowing nominal bounds", () =>
  expect(extents(makeCircle({ radius: Number.MAX_VALUE }))).toEqual([
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ]))
test("missing center retains empty bounds", () =>
  expect(
    getComprehensivePcbBounds([
      { ...makeCircle(), center: undefined } as unknown as PcbCourtyardCircle,
    ]).hasBounds,
  ).toBe(false))
test("NaN center retains legacy exception", () =>
  expect(() =>
    extents({ ...makeCircle(), center: { x: Number.NaN, y: 0 } }),
  ).toThrow())
test("raw unit center keeps parsed nominal bounds", () =>
  expect(
    extents({
      ...makeCircle(),
      center: { x: "2mm", y: "-3mm" },
    } as unknown as PcbCourtyardCircle),
  ).toEqual([1, 3, -4, -2]))
test("parsed units enclose the visible stroke", async () => {
  const circle = pcb_courtyard_circle.parse({
    ...makeCircle(),
    radius: "1mm",
    center: { x: "2mm", y: "-3mm" },
  })
  expectNearBounds(circle, [0.975, 3.025, -4.025, -1.975])
  const pixels = await measure(convertCircuitJsonToPcbSvg([circle], noPadding))
  expect(pixels.crop).toBe(0)
  expect(pixels.visible).toBeGreaterThan(0)
})
test("exterior overflow retains old nominal bounds", () =>
  expect(
    extents(
      makeCircle({
        center: { x: Number.MAX_VALUE, y: 0 },
        radius: Number.MAX_VALUE / 2,
      }),
    ),
  ).toEqual([
    Number.MAX_VALUE / 2,
    Number.POSITIVE_INFINITY,
    -Number.MAX_VALUE / 2,
    Number.MAX_VALUE / 2,
  ]))
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
for (const radius of [0.1, 1, 2])
  for (const layer of ["top", "bottom"] as const)
    test(`circle with marker remains fully visible ${radius} ${layer}`, async () => {
      const circle = makeCircle({ center: { x: 0, y: 0 }, radius, layer })
      const pixels = await measure(
        convertCircuitJsonToPcbSvg(
          [{ ...pad, layer } as AnyCircuitElement, circle],
          { ...noPadding, layer },
        ),
      )
      expect(pixels.count).toBe(1)
      expect(pixels.crop).toBe(0)
      expect(pixels.visible).toBeGreaterThan(0)
    })
for (const showCourtyards of [undefined, false])
  test(`hidden circle does not resize the visible pad ${showCourtyards}`, async () => {
    const circle = makeCircle({ center: { x: 8, y: 3 }, radius: 4 })
    const options = { ...noPadding, showCourtyards }
    expect(convertCircuitJsonToPcbSvg([pad, circle], options)).toBe(
      convertCircuitJsonToPcbSvg([pad], options),
    )
    const pixels = await measure(
      convertCircuitJsonToPcbSvg([pad, circle], options),
    )
    expect(pixels.count).toBe(0)
    expect(pixels.visible).toBe(0)
  })
for (const layer of ["top", "bottom"] as const) {
  test(`custom courtyard color stays visible ${layer}`, async () => {
    const pixels = await measure(
      convertCircuitJsonToPcbSvg([makeCircle({ layer })], {
        ...noPadding,
        layer,
        colorOverrides: { courtyard: { top: "#00aa66", bottom: "#9955ff" } },
      }),
    )
    expect(pixels.attributes?.stroke).toBe(
      layer === "top" ? "#00aa66" : "#9955ff",
    )
    expect(pixels.crop).toBe(0)
    expect(pixels.visible).toBeGreaterThan(0)
  })
  test(`mismatching layer remains invisible ${layer}`, async () => {
    const pixels = await measure(
      convertCircuitJsonToPcbSvg([makeCircle({ layer })], {
        ...noPadding,
        layer: layer === "top" ? "bottom" : "top",
      }),
    )
    expect(pixels.count).toBe(0)
    expect(pixels.visible).toBe(0)
  })
}
test("raw default layer stays top", async () => {
  const pixels = await measure(
    convertCircuitJsonToPcbSvg(
      [{ ...makeCircle(), layer: undefined } as unknown as PcbCourtyardCircle],
      { ...noPadding, layer: "top" },
    ),
  )
  expect(pixels.count).toBe(1)
  expect(pixels.attributes?.["data-pcb-layer"]).toBe("top")
  expect(pixels.crop).toBe(0)
  expect(pixels.visible).toBeGreaterThan(0)
})
test("frozen input stays unchanged", async () => {
  const circle = Object.freeze({
    ...makeCircle(),
    center: Object.freeze({ x: 2, y: -3 }),
  })
  const before = structuredClone(circle)
  const pixels = await measure(convertCircuitJsonToPcbSvg([circle], noPadding))
  expect(circle).toEqual(before)
  expect(pixels.crop).toBe(0)
  expect(pixels.visible).toBeGreaterThan(0)
})
test("ordinary note visibility keeps courtyard visible", async () => {
  const pixels = await measure(
    convertCircuitJsonToPcbSvg([makeCircle()], {
      ...noPadding,
      showPcbNotes: false,
    }),
  )
  expect(pixels.crop).toBe(0)
  expect(pixels.visible).toBeGreaterThan(0)
})
test("explicit crop preserves intentional clipping", async () => {
  const pixels = await measure(
    convertCircuitJsonToPcbSvg([makeCircle()], {
      ...noPadding,
      viewport: { minX: 1, maxX: 3, minY: -4, maxY: -2 },
    }),
  )
  expect(pixels.crop).toBeGreaterThan(0)
  expect(pixels.visible).toBeGreaterThan(0)
})
test("default padding includes the fixed stroke", async () => {
  const pixels = await measure(
    convertCircuitJsonToPcbSvg([makeCircle()], {
      width: 800,
      height: 600,
      showCourtyards: true,
    }),
  )
  expect(pixels.crop).toBe(0)
  expect(pixels.visible).toBeGreaterThan(0)
})
for (const [name, options] of Object.entries({
  top: {},
  bottom: { layer: "bottom" as const },
  tiny: { radius: 0.001 },
}))
  test(`circle stroke snapshot ${name}`, () => {
    const circle = makeCircle(options)
    expect(
      convertCircuitJsonToPcbSvg([circle], {
        ...noPadding,
        layer: circle.layer,
      }),
    ).toMatchSvgSnapshot(`${import.meta.path}-${name}`)
  })
test("hidden circle snapshot preserves pad viewport", () =>
  expect(
    convertCircuitJsonToPcbSvg(
      [pad, makeCircle({ center: { x: 8, y: 3 }, radius: 4 })],
      { ...noPadding, showCourtyards: false },
    ),
  ).toMatchSvgSnapshot(`${import.meta.path}-hidden`))
test("board physical dimensions and camera stay nominal", () => {
  const board = {
    type: "pcb_board",
    pcb_board_id: "board",
    center: { x: 2, y: -3 },
    width: 2,
    height: 2,
  } as AnyCircuitElement
  const b = getComprehensivePcbBounds([board, makeCircle()])
  expect([b.boardMinX, b.boardMaxX, b.boardMinY, b.boardMaxY]).toEqual([
    1, 3, -4, -2,
  ])
  expect(convertCircuitJsonToPcbSvg([board, makeCircle()], noPadding)).toBe(
    convertCircuitJsonToPcbSvg([board, makeCircle()], {
      ...noPadding,
      viewport: { minX: 1, maxX: 3, minY: -4, maxY: -2 },
    }),
  )
})
test("pads stay nominal and polygon bounds include stroke", () => {
  const b = getComprehensivePcbBounds([pad])
  expect([b.minX, b.maxX, b.minY, b.maxY]).toEqual([-1, 1, -1, 1])
  const polygon = {
    type: "pcb_courtyard_polygon",
    pcb_courtyard_polygon_id: "poly",
    pcb_component_id: "component",
    layer: "top",
    points: [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 2, y: 2 },
    ],
  } as AnyCircuitElement
  const n = getComprehensivePcbBounds([polygon])
  expect([n.minX, n.maxX, n.minY, n.maxY]).toEqual([
    -0.025, 4.025, -0.025, 2.025,
  ])
})
