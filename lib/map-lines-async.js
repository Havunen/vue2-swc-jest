import {SourceMapConsumer, SourceMapGenerator} from 'source-map';

export async function mapLinesAsync(oldMap, newMap) {
  if (!oldMap) return newMap
  if (!newMap) return oldMap

  const oldMapConsumer = await new SourceMapConsumer(oldMap)
  const newMapConsumer = await new SourceMapConsumer(newMap)
  const mergedMapGenerator = new SourceMapGenerator()

  newMapConsumer.eachMapping(m => {
    if (m.originalLine == null) {
      return
    }

    const origPosInOldMap = oldMapConsumer.originalPositionFor({
      line: m.originalLine,
      column: m.originalColumn
    })

    if (origPosInOldMap.source == null) {
      return
    }

    mergedMapGenerator.addMapping({
      generated: {
        line: m.generatedLine,
        column: m.generatedColumn
      },
      original: {
        line: origPosInOldMap.line, // map line
        // use current column, since the oldMap produced by @vue/compiler-sfc
        // does not
        column: m.originalColumn
      },
      source: origPosInOldMap.source,
      name: origPosInOldMap.name
    })
  })

  // source-map's type definition is incomplete
  const generator = mergedMapGenerator
  for (const sourceFile of oldMapConsumer.sources) {
    // generator.sources.add(sourceFile)
    const sourceContent = oldMapConsumer.sourceContentFor(sourceFile)
    if (sourceContent != null) {
      mergedMapGenerator.setSourceContent(sourceFile, sourceContent)
    }
  }

  generator._sourceRoot = oldMap.sourceRoot
  generator._file = oldMap.file
  return generator.toJSON()
}
