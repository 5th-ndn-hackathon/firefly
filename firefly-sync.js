/*
 * Copyright (C) 2017-2017 Regents of the University of California.
 * @author: Peter Gusev <peter@remap.ucla.edu>
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

fireflySyncDebug = true; // toggle this to turn on / off for global controll

if (fireflySyncDebug) var debug = console.log.bind(window.console);
else var debug = function(){};

/**
 * FireflySync provides sync mechanism similar to ChronoSync, only backed by Firestore backend.
 * @param {firebase.firestore.Firestore} An initialized Firestore object
 * @param syncDoc 	A string - Firebase document name for synchronization; this 
 *					document will be created if it does not exist; if it exists, 
 * 					sequence number will be picked from the storage.
 * @param applicationPrefix 	Simliar to ChronoSync, this is an application prefix, which 
 *								client code will use for data publishing.
 * @param onReceivedSyncState 	A callback (function({'prefix':<seq-no>})) which will be called
 *								whenever new updates (sequence numbres) are received.
 */
var FireflySync = function FireflySync(firestoreDb, syncDoc, applicationPrefix, onInitialized, onReceivedSyncState){
	this.firestoreDb = firestoreDb;
	this.onReceivedSyncState = onReceivedSyncState;
	this.applicationDataPrefixUri = applicationPrefix;
	this.syncDoc = syncDoc;
	this.syncData = {};
	this.mySeqNo = -1;
	this.initialized = false;
	var self = this;

	this.firestoreDb.doc(this.syncDoc).onSnapshot(function(snapshot){
		if (!snapshot.exists)
		{
			debug('> firefly-sync: sync doc does not exist.');
  			// setup empty document
  			self.firestoreDb.doc(self.syncDoc).set({})
  			.then(function(){
  				debug('> firefly-sync: new sync doc created');
  			})
  			.catch(function(error){
  				console.error('> firefly-sync: error creating sync doc: ', error);
  			});
		}
		else
		{
			debug('> firefly-sync: received doc snapshot: ', snapshot.data());

			var delta = {}
			var syncData = snapshot.data();
			for (var key in syncData)
			{
				var decodedKey = decodeURIComponent(key);
				var newValue = !(decodedKey in self.syncData) && decodedKey != self.applicationDataPrefixUri;
				if (!newValue) newValue = (syncData[key] > self.syncData[decodedKey]);
				if (newValue) delta[decodedKey] = syncData[key];

				// update our seq no if needed
				if (decodedKey == self.applicationDataPrefixUri && self.mySeqNo < syncData[key])
					self.mySeqNo = syncData[key];

				self.syncData[decodedKey] = syncData[key];
			}

			if (Object.keys(delta).length)
			{
				// self.onReceivedSyncState(delta);
				// this if for backward compatibnility with old ChronoChat code
				// if you don't need this compatibility, use the line above
				var syncStates = [];
				for (var key in delta)
				{
					 syncStates.push(new ChronoSync2013.SyncState (key, 0, delta[key], new Blob()));
				}
				self.onReceivedSyncState(syncStates);
			}
			else
				debug('> firefly-sync: no sync updates');
		}
		
		if (!self.initialized)
		{
			self.initialized = true
			onInitialized();
		}
	}, 
	function(err) {
    	debug('> firefly-sync: encountered error while getting updates: ${err}');
	});
};

/**
 * Simliar to ChronoSync, this will increment current sequence number and notify all other participants
 * through updating sync document.
 * @return New sequence number
 */
FireflySync.prototype.publishNextSequenceNo = function(){
	this.mySeqNo++;
	var prefix = encodeURIComponent(this.applicationDataPrefixUri);
	var self = this;

	this.firestoreDb.doc(this.syncDoc).update({
		[prefix] : self.mySeqNo
	})
	.then(function(){
		debug("> firefly-sync: updated sync doc with new seq no ", self.mySeqNo);
	})
	.catch(function(error){
		console.error('> firefly-sync: error updating sync doc: ', error);
	});

	return this.mySeqNo;
}

/**
 * Returns current sequence number
 */
FireflySync.prototype.getSequenceNo = function(){
	return this.syncData[this.applicationDataPrefixUri];
}