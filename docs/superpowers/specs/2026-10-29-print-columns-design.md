# Print columns design — approved 29/10/2026

Telegram ID after the seller name separator is bold and 1pt larger than the surrounding name. Zalo uses the employee mobilePhone from KiotViet `/users`, matched to sold_by_id within the correct retailer; absent or unavailable contacts remain blank. New assignment snapshots retain the resolved phone; older snapshots receive a read-only contact supplement.

The lower money, notes and signature sections use white-border tables with explicit colgroups. Dragging column edges changes adjacent widths while retaining a total of 100%. Font size, alignment, bold and italic changes propagate to the corresponding column in the same table and section, with goods headers remaining independently adjustable. Footer tables do not affect goods columns or one another. Shared settings persist through the existing versioned API; downloaded HTML includes the same formatting controls.

Delivery goods have six columns. Validation must accept exactly six widths, rejecting a seventh column. The allowed footer maps are order: summary(4), signatures(2), notes(1); delivery: deliverySignatures(3), deliveryNote(1). Only validated formatting metadata is saved, never arbitrary HTML or order text. Existing saved group-size settings remain readable; new size edits apply per column.

Validation: node:test/JSDOM tests and real Edge mouse dragging against the actual layout validator, reopen/reset/export checks, 1/45-row layouts, white borders in print media and A4 PDF generation.

Source for Kiot fields: https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/retail-ket-noi-api/public-api/ (section 2.8, checked 29/10/2026).
