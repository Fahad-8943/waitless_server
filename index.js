const express = require("express");
const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("API is running");
});

app.post("/products", (req, res) => {
  console.log(req.body);
  res.send("Product added recived");
});

app.get("/products/:id", (req, res) => {
  console.log(req.params);
    res.send("Product with id found");

});
app.get("/products", (req, res) => {
  console.log(req.query);
    res.send("Product with query found");

});

app.listen(3000, () => {
  console.log("Server Running on Port 3000");
});
