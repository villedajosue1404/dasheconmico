/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const transactions = new Collection({
    name: "transactions",
    type: "base",
    schema: [
      { name: "business_id",  type: "relation", options: { collectionId: "businesses", maxSelect: 1 }, required: true },
      { name: "type",         type: "select",   options: { values: ["sale","expense"] }, required: true },
      { name: "amount",       type: "number",   required: true },
      { name: "description",  type: "text" },
      { name: "category",     type: "text" },
      { name: "date",         type: "text" },
    ],
    listRule:   "",
    viewRule:   "",
    createRule: "",
    updateRule: "",
    deleteRule: "",
  });
  return Dao(db).saveCollection(transactions);
}, (db) => {
  const col = Dao(db).findCollectionByNameOrId("transactions");
  return Dao(db).deleteCollection(col);
});
