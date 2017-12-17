/**
 * Copyright (C) 2017 Regents of the University of California.
 * @author: Jeff Thompson <jefft0@remap.ucla.edu>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 * A copy of the GNU Lesser General Public License is in the file COPYING.
 */

/**
 * FireflyFace extends Face to override expressInterest, registerPrefix and
 * putData to interface with Google Firestore.
 * @param {firebase.firestore.Firestore} (optional) The Firestore object which
 * is already created. If omitted, use the default "ndn-firefly" project.
 */
var FireflyFace = function FireflyFace(db)
{
  // Call the base constructor.
  // Make Face.reconnectAndExpressInterest call expressInterestHelper directly.
  Face.call(new Transport(), { equals: function() { return true; } });
  this.readyStatus = Face.OPENED;

  if (db == undefined) {
    var config = {
      apiKey: "AIzaSyCDa5xAuQw78RwcpIDT0NmgmcJ9WVL60GY",
      authDomain: "ndn-firefly.firebaseapp.com",
      databaseURL: "https://ndn-firefly.firebaseio.com",
      projectId: "ndn-firefly",
      storageBucket: "",
      messagingSenderId: "225388759140"
    };
    firebase.initializeApp(config);

    db = firebase.firestore();
  }

  this.db_ = db;
};

FireflyFace.prototype = new Face(new Transport(), { equals: function() { return true; } });
FireflyFace.prototype.name = "FireflyFace";

/**
 * Override to do the work of expressInterest using Firestore.
 */
FireflyFace.prototype.expressInterestHelper = function
  (pendingInterestId, interest, onData, onTimeout, onNetworkNack, wireFormat)
{
  // First check if the Data packet is already in Firestore.
  // TODO: Check MustBeFresh.
  this.getMatchingDataPromise_(interest.getName(), interest.getMustBeFresh())
  .then(function(data) {
    if (data != null)
      // Answer onData immediately.
      onData(interest, data);
    else {
      // TODO: Insert an interest into Firestore.
    }
  }).catch(function(error) {
    console.log("Error in expressInterest:", error);
  });
};

/**
 * Override to do the work of registerPrefix using Firestore.
 */
FireflyFace.prototype.nfdRegisterPrefix = function
  (registeredPrefixId, prefix, onInterest, flags, onRegisterFailed,
   onRegisterSuccess, commandKeyChain, commandCertificateName, wireFormat)
{
  console.log("Debug Register prefix");
  // TODO: Implement.
};

/**
 * The OnInterest callback calls this to put a Data packet which satisfies an
 * Interest. Override to put the Data packet into Firestore.
 * @param {Data} data The Data packet which satisfies the interest.
 * @param {WireFormat} wireFormat (optional) A WireFormat object used to encode
 * the Data packet. If omitted, use WireFormat.getDefaultWireFormat().
 * @throws Error If the encoded Data packet size exceeds getMaxNdnPacketSize().
 */
FireflyFace.prototype.putData = function(data, wireFormat)
{
  wireFormat = (wireFormat || WireFormat.getDefaultWireFormat());

  var encoding = data.wireEncode(wireFormat);
  if (encoding.size() > Face.getMaxNdnPacketSize())
    throw new Error
      ("The encoded Data packet size exceeds the maximum limit getMaxNdnPacketSize()");

  // TODO: Check if we can remove Interest fields in Firestore.
  this.setDataPromise_(data)
  .catch(function(error) {
    console.log("Error in putData:", error);
  });
};

/**
 * Look in Firestore for an existing Data packet which matches the name.
 * @param {Name} name The Name.
 * @param {boolean} mustBeFresh If true, make sure the Data is not expired
 * according to the Firestore document "storeTime" and "freshnessPeriod".
 * @returns {Promise} A promise that returns the matching Data, or returns null
 * if not found.
 */
FireflyFace.prototype.getMatchingDataPromise_ = function(name, mustBeFresh)
{
  // TODO: Check mustBeFresh.
  return this.db_.doc(FireflyFace.toFirestorePath(name)).get()
  .then(function(doc) {
    if (doc.exists && doc.data().data) {
      var data = new Data();
      // TODO: Check for decoding error.
      data.wireDecode(new Blob(doc.data().data.toUint8Array(), false));
      return SyncPromise.resolve(data);
    }
    else
      return SyncPromise.resolve(null);
  });
};

/**
 * Get the Firestore path for the Name, for example "/ndn/_/user/_/file/_".
 * @param {Name} name The Name.
 * @returns {string} The Firestore path.
 */
FireflyFace.toFirestorePath = function(name)
{
  var result = "";

  for (var i = 0; i < name.size(); ++i)
    result += "/"+ name.components[i].toEscapedString() + "/_";

  return result;
};

/**
 * Set the "data", "storeTime" and "freshnessPeriod" fields in the Firestore
 * document based on data.getName(). If the freshnessPeriod is not specified,
 * this sets it to null. This replaces existing fields.
 * @param {Data} data The Data packet.
 * @param {WireFormat} wireFormat A WireFormat object used to encode the Data
 * packet.
 * @return {Promise} A promise that fulfills when the operation is complete.
 */
FireflyFace.prototype.setDataPromise_ = function(data, wireFormat)
{
  return this.establishDocumentPromise_(data.getName())
  .then(function(document) {
    return document.set({
      data: firebase.firestore.Blob.fromBase64String
        (data.wireEncode(wireFormat).buf().toString('base64')),
      storeTime: firebase.firestore.FieldValue.serverTimestamp(),
      freshnessPeriod: data.getMetaInfo().getFreshnessPeriod()
    }, { merge: true });
  });
};

/**
 * Get the Firestore document for the given name, creating the "children"
 * documents at each level in the collection tree as needed. For example, if
 * Firestore has the document /ndn/_/user/_/joe_ and you ask for the document
 * for the name /ndn/role/doctor this returns the document
 * /ndn/_/role/_/leader_ and adds { role: null } to /ndn/children and adds
 * { doctor: null } to /ndn/_/role/children . (We represent the set of children
 * by an object with the set elements are the key and the value is null.)
 * @param {Name} name The Name for the document.
 * @returns {Promise} A promise that returns the
 * firebase.firestore.DocumentReference .
 */
FireflyFace.prototype.establishDocumentPromise_ = function(name)
{
  // Update the "children" document of the collection, and recursively call this
  // with each component until the collection for the final component and return
  // its "_" document.
  var establish = function(collection, iComponent) {
    if (iComponent >= name.size() - 1)
      // We're finished.
      return SyncPromise.resolve(collection.doc("_"));
    else {
      var childString = name.get(iComponent + 1).toEscapedString();
      // Update the "children" document.
      return collection.doc("children").set
        ({ [childString]: null }, { merge: true })
      .then(function () {
        return establish(collection.doc("_").collection(childString), iComponent + 1);
      });
    }
  };

  return establish(this.db_.collection(name.get(0).toEscapedString()), 0);
};
