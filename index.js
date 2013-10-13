var callbacks = require("when/callbacks");
var express = require("express");
var nodefn = require("when/node/function");
var crypto = require("crypto");
var when = require("when");
var path = require("path");
var fs = require("fs");


var xfs = {};
["exists"].forEach(function (key) {
  xfs[key] = callbacks.bind(fs[key].bind(fs));
});
["mkdir", "rename", "unlink"].forEach(function (key) {
  xfs[key] = nodefn.bind(fs[key].bind(fs));
});


var secretHeaderRegexp = /^Secret (.+)$/;
var filesDirectory = path.join(__dirname, "files");
var tempDirectory = path.join(__dirname, "temp");
var app = express();


app.use("/files", express.static(filesDirectory));

app.post("/files/:fileName", function (req, res) {
  var authorization = req.get("authorization");
  if (!authorization) return res.send(401);

  var matches = authorization.match(secretHeaderRegexp);
  if (!matches) return res.send(401);

  var secret = matches[1];
  if (secret !== app.get("secret")) return res.send(401);

  var tempFilePath = path.join(tempDirectory, crypto.createHash("md5").update(String(Math.random())).digest("hex"));

  when((function () {
    var deffered = when.defer();

    var shasum = crypto.createHash("sha1");
    var md5sum = crypto.createHash("md5");
    var tempFile = fs.createWriteStream(tempFilePath);

    req.on("data", function (data) {
      shasum.update(data);
      md5sum.update(data);
      tempFile.write(data);
    });

    req.on("error", function (err) {
      deffered.reject(err);
    });

    tempFile.on("error", function (err) {
      deffered.reject(err);
    });

    req.on("end", function () {
      tempFile.end();
      deffered.resolve(shasum.digest("hex").slice(0, 8)
                     + md5sum.digest("hex").slice(0, 8));
    });

    return deffered.promise;
  })())
  .then(function (hash) {
    var fileDirectory = path.join(filesDirectory, hash);
    var filePath = path.join(fileDirectory, req.params.fileName);
    var url = "//" + app.get("host") + "/files/" + hash + "/" + req.params.fileName;

    return when.join(fileDirectory, filePath, url, xfs.exists(fileDirectory));
  })
  .spread(function (fileDirectory, filePath, url, fileDirectoryExists) {
    if (fileDirectoryExists) {
      return when.join(filePath, url);
    } else {
      return when.join(filePath, url, xfs.mkdir(fileDirectory));
    }
  })
  .spread(function (filePath, url) {
    return when.join(filePath, url, xfs.exists(filePath));
  })
  .spread(function (filePath, url, fileExists) {
    if (fileExists) {
      return when.join(url, xfs.unlink(tempFilePath));
    } else {
      return when.join(url, xfs.rename(tempFilePath, filePath));
    }
  })
  .spread(function (url) {
    res.set("Location", url);
    res.send(201);
  })
  .then(null, function (err) {
    console.log(err);
    res.send(500);
  });
});


if (require.main === module) {
  var secret = process.env.npm_config_secret;
  var port = process.env.npm_config_port || 3300;
  var host = process.env.npm_config_host || "localhost";

  if (!secret) {
    console.error("Secret not set. Run `npm config set secret SECRET` to configure.");
    process.exit(1);
  }

  app.set("secret", secret);
  app.set("host", host);

  app.listen(port, function () {
    console.log("Listening " + host);
  });
}
