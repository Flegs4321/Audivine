/**
 * Built-in bulletin layout (original app styling) when no template file is present.
 */

import type { WordExportModel } from "./word-export-model";

export async function renderProgrammaticWordDoc(model: WordExportModel): Promise<Blob> {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    AlignmentType,
    BorderStyle,
    WidthType,
    Table,
    TableRow,
    TableCell,
    ShadingType,
  } = await import("docx");

  const docElements: Array<InstanceType<typeof Paragraph> | InstanceType<typeof Table>> = [];

  docElements.push(
    new Paragraph({
      children: [],
      spacing: { after: 100 },
    })
  );

  docElements.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              borders: {
                top: { style: BorderStyle.SINGLE, size: 6, color: "0066CC" },
                bottom: { style: BorderStyle.SINGLE, size: 6, color: "0066CC" },
                left: { style: BorderStyle.SINGLE, size: 6, color: "0066CC" },
                right: { style: BorderStyle.SINGLE, size: 6, color: "0066CC" },
              },
              shading: { fill: "FFFFFF", type: ShadingType.SOLID },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: model.churchName.toUpperCase(),
                      color: "FF6600",
                      bold: true,
                      size: 28,
                    }),
                  ],
                  spacing: { after: 100 },
                }),
                new Paragraph({
                  children: [
                    new TextRun({
                      text: model.churchAddress,
                      color: "6BB3FF",
                      size: 24,
                    }),
                  ],
                }),
              ],
              margins: { top: 200, bottom: 200, left: 300, right: 300 },
            }),
          ],
        }),
      ],
    })
  );

  docElements.push(
    new Paragraph({
      children: [
        new TextRun({
          text: model.sermonDate,
          color: "000000",
          bold: true,
          size: 28,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 300 },
    })
  );

  const sectionHeaderStyle = { color: "1976D2", bold: true, size: 22 };
  const sectionHeaderShading = { fill: "D1E9FF", type: ShadingType.SOLID };
  const sectionHeaderBorder = {
    top: { style: BorderStyle.SINGLE, size: 3, color: "1976D2" },
    bottom: { style: BorderStyle.SINGLE, size: 3, color: "1976D2" },
  };

  const pushSectionHeader = (title: string, spacing: { before: number; after: number }) => {
    docElements.push(
      new Paragraph({
        children: [new TextRun({ text: title, ...sectionHeaderStyle })],
        shading: sectionHeaderShading,
        border: sectionHeaderBorder,
        spacing,
        indent: { left: 200 },
      })
    );
  };

  const pushBullets = (items: string[], emptyFallback: string) => {
    if (items.length > 0) {
      items.forEach((item) => {
        docElements.push(
          new Paragraph({
            children: [new TextRun({ text: `➤ ${item}`, size: 18 })],
            spacing: { after: 80 },
            indent: { left: 300 },
          })
        );
      });
    } else {
      docElements.push(
        new Paragraph({
          children: [new TextRun({ text: emptyFallback, size: 18, italics: true })],
          spacing: { after: 80 },
          indent: { left: 300 },
        })
      );
    }
  };

  pushSectionHeader("ANNOUNCEMENTS", { before: 0, after: 120 });
  pushBullets(model.announcements, "➤ No announcements");

  pushSectionHeader("UPCOMING EVENTS", { before: 100, after: 100 });
  if (model.upcomingEvents.length > 0) {
    model.upcomingEvents.forEach((item) => {
      docElements.push(
        new Paragraph({
          children: [new TextRun({ text: `➤ ${item}`, size: 18 })],
          spacing: { after: 80 },
          indent: { left: 300 },
        })
      );
    });
  } else {
    docElements.push(new Paragraph({ children: [], spacing: { after: 80 } }));
  }
  const eventsCount = model.upcomingEvents.length || 0;
  for (let i = 0; i < 6 - eventsCount; i++) {
    docElements.push(new Paragraph({ children: [], spacing: { after: 80 } }));
  }

  pushSectionHeader("SHARING", { before: 100, after: 100 });
  pushBullets(model.sharing, "➤ No prayer requests or sharing");

  pushSectionHeader(model.messageTitle, { before: 100, after: 100 });
  if (model.sermonBullets.length > 0) {
    model.sermonBullets.forEach((item) => {
      docElements.push(
        new Paragraph({
          children: [new TextRun({ text: `➤ ${item}`, size: 18 })],
          spacing: { after: 80 },
          indent: { left: 300 },
        })
      );
    });
  } else {
    docElements.push(
      new Paragraph({
        children: [
          new TextRun({ text: "➤ No sermon summary available", size: 18, italics: true }),
        ],
        spacing: { after: 80 },
        indent: { left: 300 },
      })
    );
  }

  docElements.push(new Paragraph({ children: [], spacing: { before: 300, after: 0 } }));

  const redBar = (text: string, size: number, green = false) =>
    new Paragraph({
      children: [
        new TextRun({
          text,
          color: green ? "00FF00" : "FFFFFF",
          bold: true,
          size,
        }),
      ],
      shading: { fill: "CC0000", type: ShadingType.SOLID },
      spacing: { after: 80 },
    });

  docElements.push(redBar(model.spotifyLine1, 18));
  docElements.push(redBar(model.spotifyLine2, 18));
  docElements.push(redBar(model.spotifyChannel, 32, true));

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 720, right: 720, bottom: 720, left: 720 },
          },
        },
        children: docElements,
      },
    ],
  });

  return Packer.toBlob(doc);
}
