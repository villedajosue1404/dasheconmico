/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const posts = new Collection({
    name: "posts",
    type: "base",
    schema: [
      { name: "business_id",     type: "relation", options: { collectionId: "businesses", maxSelect: 1 } },
      { name: "network",         type: "select",   options: { values: ["fb","tg","both"] }, required: true },
      { name: "text",            type: "text",     required: true },
      { name: "status",          type: "select",   options: { values: ["draft","scheduled","published"] } },
      { name: "scheduled_date",  type: "text" },
      { name: "scheduled_time",  type: "text" },
      { name: "reach",           type: "number" },
      { name: "engagement",      type: "number" },
      { name: "cost",            type: "number" },
    ],
    listRule:   "",
    viewRule:   "",
    createRule: "",
    updateRule: "",
    deleteRule: "",
  });
  return Dao(db).saveCollection(posts);
}, (db) => {
  const col = Dao(db).findCollectionByNameOrId("posts");
  return Dao(db).deleteCollection(col);
});
