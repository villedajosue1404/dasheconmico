/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  // ── businesses ──────────────────────────────────────
  const businesses = new Collection({
    name: "businesses",
    type: "base",
    schema: [
      { name: "name",        type: "text",   required: true },
      { name: "description", type: "text" },
      { name: "category",    type: "text" },
      { name: "color",       type: "text" },
      { name: "tg_token",   type: "text" },
      { name: "tg_chatid",  type: "text" },
      { name: "fb_token",   type: "text" },
      { name: "fb_pageid",  type: "text" },
    ],
    listRule:   "",
    viewRule:   "",
    createRule: "",
    updateRule: "",
    deleteRule: "",
  });
  return Dao(db).saveCollection(businesses);
}, (db) => {
  const col = Dao(db).findCollectionByNameOrId("businesses");
  return Dao(db).deleteCollection(col);
});
