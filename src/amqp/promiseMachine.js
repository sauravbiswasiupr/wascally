var _ = require( 'lodash' ),
	amqp = require( 'amqplib' ),
	Monologue = require( 'monologue.js' )( _ ),
	when = require( 'when' ),
	machina = require( 'machina' )( _ ),
	log = require( '../log.js' );

var staticId = 0;

module.exports = function( factory, target, release, disposalEvent ) {
	var disposalEvent = disposalEvent || 'close';
	var PromiseMachine = machina.Fsm.extend( {
		id: staticId++,
		initialState: 'acquiring',
		item: undefined,
		waitInterval: 0,
		waitMax: 5000,
		_acquire: function() {
			this.emit( 'acquiring' );
			factory()
				.then( function( o ) {
					this.item = o;
					this.waitInterval = 0;
					if( this.item.on ) {
						this.disposeHandle = this.item.once( disposalEvent, function( err ) {
							this.emit( 'lost' );
							this.transition( 'released' );
						}.bind( this ) );
						this.item.once( 'error', function( err ) {
							this.transition( 'failed' );
						}.bind( this ) );
					}
					this.transition( 'acquired' );
				}.bind( this ) )
				.then( null, function( err ) {
					log.info( { message: 'failure occured acquiring a resource', error: err.stack } );
					this.emit( 'failed', err );
					this.handle( 'failed' );
				}.bind( this ) )
				.catch( function( ex ) {
					log.info( { message: 'failure occured acquiring a resource', error: ex.stack } );
					this.emit( 'failed', tex );
					this.handle( 'failed' );
				} );
		},
		_release: function() {
			try {
					if( this.item ) {
					this.item.removeAllListeners();
					this.emit( 'releasing' );
					if( !this.item ) {
						return;
					}
					if( release ) {
						release( this.item );
					} else {
						this.item.close();
					}
				}
			} catch( err ) {

			}
		},
		acquire: function() {
			this.handle( 'acquire' );
			return this;
		},
		destroy: function() {
			this.handle( 'destroy' );
		},
		operate: function( call, args ) {
			var op = { operation: call, argList: args, index: this.index },
				promise = when.promise( function( resolve, reject ) {
					op.resolve = resolve;
					op.reject = reject;
				} );
			this.handle( 'operate', op );
			return promise;
		},
		release: function() {
			this.handle( 'release' );
		},
		states: {
			'acquiring': {
				_onEnter: function() {
					this._acquire();
				},
				failed: function() {
					setTimeout( function() {
						this.transition( 'failed' );
						if( ( this.waitInterval + 100 ) < this.waitMax ) {
							this.waitInterval += 100;
						}
					}.bind( this ), this.waitInterval );
				},
				destroy: function() {
					this._release();
					this.item = undefined;
					this.transition( 'destroyed' );
				},
				release: function () {
					this._release();
					this.transition( 'released' );
				},
				operate: function( call ) {
					this.deferUntilTransition( 'acquired' );
				}
			},
			'acquired': {
				_onEnter: function() {
					this.emit( 'acquired' );
				},
				destroy: function() {
					this._release();
					this.item = undefined;
					this.transition( 'destroyed' );
				},
				operate: function( call ) {
					try {
						var result = this.item[ call.operation ].apply( this.item, call.argList );
						if( result && result.then ) {
							result
								.then( call.resolve )
								.then( null, call.reject );
						} else {
							call.resolve( result );
						}
					} catch( err ) {
						call.reject( err );
					}
				}, 
				invalidated: function() {
					this.transition( 'acquiring' );
				},
				release: function () {
					this._release();
					this.transition( 'released' );
				}
			},
			'destroyed': {
				_onEnter: function() {
					
				}
			},
			'released': {
				_onEnter: function() {
					this.emit( 'released', this.id );
				},
				acquire: function() {
					this.transition( 'acquiring' );
				},
				operate: function( call ) {
					this.deferUntilTransition( 'acquired' );
					this.transition( 'acquiring' );
				},
				destroy: function() {
					this.transition( 'destroyed' );
				}
			},
			'failed': {
				_onEnter: function() {
					this.emit( 'failed', this.lastError );
					setTimeout( function() {
						this.transition( 'acquiring' );
						if( ( this.waitInterval + 100 ) < this.waitMax ) {
							this.waitInterval += 100;
						}
					}.bind( this ), this.waitInterval );
				},
				operate: function( call ) {
					this.deferUntilTransition( 'acquired' );
				}
			}
		}
	} );

	Monologue.mixin( PromiseMachine );
	var machine = new PromiseMachine();
	_.each( target.prototype, function( prop, name ) {
		if( _.isFunction( prop ) ) {
			machine[ name ] = function() { 
				var list = Array.prototype.slice.call( arguments, 0 );
				return machine.operate( name, list );
			}.bind( machine );
		}
	} );
	return machine;
};