// pb_hooks/cors.pb.js
// Allow all origins so the HTML file can connect from any IP
routerAdd("OPTIONS", "/*", (c) => {
  c.response().header().set("Access-Control-Allow-Origin", "*");
  c.response().header().set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  c.response().header().set("Access-Control-Allow-Headers", "Content-Type,Authorization");
  return c.noContent(204);
});

onBeforeServe((e) => {
  e.app.onBeforeApiError().add((ev) => {
    ev.httpContext.response().header().set("Access-Control-Allow-Origin", "*");
    ev.httpContext.response().header().set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    ev.httpContext.response().header().set("Access-Control-Allow-Headers", "Content-Type,Authorization");
  });
});
