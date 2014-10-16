module.exports = function($E, $L, $MethodBuilder, users, async) {
  
  /**
	 * Retrieves the specified user object from the database using
	 * the profile returned by passport.js, or calls back with
	 * $E.NotFound
	 *
	 * @param {Object} transaction a structure of transaction-enabled database connections
	 * @param {String} authProvider currently only 'google' is supported.
	 * @param {Object} profile a user profile provided by Google, in the passport.js format
	 * @param {Function} done Callback format done(null, {Object}) or
	 *                            done(err, null)
	 */
	$MethodBuilder.add('getUserByProfile', function(transaction, authProvider, profile, done) {
		var authProviderIdHashed = require('crypto').createHash('sha512').update(profile.id).digest('hex');
		async.waterfall([
			function(next) {
				transaction.mysql.query('SELECT * FROM registered_user WHERE auth_provider=? AND auth_id=?',
	    		[authProvider, authProviderIdHashed], next);
			},
			function(rows, fields, next) {
				if (rows.length === 0) {
					next(new $E.NotFound('Specified user was not found in the database.'), null);
				} else {
					var user = {
	          id:rows[0].id,
	          authProvider:rows[0].auth_provider,
	          authProviderId:rows[0].auth_id,
	          displayName:rows[0].display_name,
	          preferredEmail:rows[0].preferred_email,
	          preferredEmailMd5:rows[0].preferred_email_md5,
	          givenName:rows[0].given_name,
	          familyName:rows[0].family_name,
	          pictureURL:rows[0].picture_url,
	          betaKey:rows[0].beta_key,
	          middleName:undefined
	        };
	        next(null, user);
				}
			}
		], done);
	});


	/**
	 * Retrieves the specified user object from the database by id,
	 * or calls back with an $E.NotFound
	 *
	 * @param {Object} transaction a structure of transaction-enabled database connections
	 * @param {Number} userId the id of a user in the database
	 * @param {Function} done Callback format done(null, {Object}) or
	 *                            done(err, null)
	 */
  $MethodBuilder.add('getUser', function(transaction, userId, done) {
  	async.waterfall([
  		function(next) {
  			transaction.mysql.query('SELECT * FROM registered_user WHERE id=?', [userId], next);
  		},
  		function(rows, fields, next) {
  			if (rows.length === 0) {
	        next(new $E.NotFound('Specified user was not found in the database.'), null);
	      } else {
	      	var user = {
		        id:rows[0].id,
		        authProvider:rows[0].auth_provider,
		        authProviderId:rows[0].auth_id,
		        displayName:rows[0].display_name,
		        preferredEmail:rows[0].preferred_email,
		        preferredEmailMd5:rows[0].preferred_email_md5,
		        givenName:rows[0].given_name,
		        familyName:rows[0].family_name,
		        pictureURL:rows[0].picture_url,
		        betaKey:rows[0].beta_key,
		        middleName:undefined
		      };
		      next(null, user);
	      }
  		}
		], done);
  });

	/**
	 * Automatically creates, updates or retrieves a user from the database
	 * using the profile returned from google via passport.js
	 *
	 * @param {Object} transaction a structure of transaction-enabled database connections
	 * @param {String} authProvider currently only 'google' is supported.
	 * @param {Object} profile a user profile provided by Google, in the passport.js format
	 * @param {Function} callback Callback format callback(null, {Object}) or
	 *                            callback(err, null)
	 */
  $MethodBuilder.add('getOrCreateUser', function(transaction, authProvider, profile, done) {
  	var authProviderIdHashed = require('crypto').createHash('sha512').update(profile.id).digest('hex');
	  var preferredEmail = profile.emails.length>0 ? profile.emails[0].value : undefined;
	  var preferredEmailHashed = profile.emails.length>0 ? require('crypto').createHash('md5').update(profile.emails[0].value).digest('hex') : undefined;
	  var pictureURL;
	  if (profile._json && profile._json.picture) {
	    pictureURL = profile._json.picture;
	  }

	  //does the user exist already?
		users.getUserByProfile(transaction, authProvider, profile, function(err, existingUser) {
			if (err instanceof $E.NotFound) {
				//create user, then return them
				async.waterfall([
			  	function(next) {
			  		transaction.mysql.query(
	            'INSERT INTO registered_user SET ? ',
	            {
	              'auth_provider':authProvider,
	              'auth_id':authProviderIdHashed,
	              'display_name':profile.displayName,
	              'preferred_email':preferredEmail,
	              'preferred_email_md5':preferredEmailHashed,
	              'given_name':profile.name.givenName,
	              'family_name':profile.name.familyName,
	              'picture_url':pictureURL
	            }, next);
			  	},
			  	function(result, fields, next) {
			  		users.getUser(transaction, result.insertId, next)
			  	}
		  	], done);
			} else if (err) {
				done(err, null);
			} else {
				//update user with the current profile, then return the user
				async.waterfall([
					function(next) {
						transaction.mysql.query('UPDATE registered_user ' +
			        'SET ? WHERE auth_provider='+transaction.mysql.escape(authProvider)+' ' +
			        'AND auth_id='+transaction.mysql.escape(authProviderIdHashed),
			        {
			          'display_name':profile.displayName,
			          'preferred_email':profile.emails.length>0 ? profile.emails[0].value : undefined,
			          'preferred_email_md5':preferredEmailHashed,
			          'given_name':profile.name.givenName,
			          'family_name':profile.name.familyName,
			          'picture_url':pictureURL
			        }, next);
					},
					function(result, fields, next) {
						users.getUserByProfile(transaction, authProvider, profile, done);
					}
				], done);
			}
		});
  });

};