import { Schema, type, MapSchema } from '@colyseus/schema'

export class ShipState extends Schema {
  @type('string') id = ''
  @type('string') name = 'Raven'
  @type('number') x = 0
  @type('number') y = 0
  @type('number') z = 0
  @type('string') currentCelestialId = 'planet-1'
  @type('number') shield = 5000
  @type('number') shieldMax = 5000
  @type('number') armor = 4000
  @type('number') armorMax = 4000
  @type('number') hull = 6000
  @type('number') hullMax = 6000
  @type('number') capacitor = 800
  @type('number') capacitorMax = 800
}

export class StarSystemRoomState extends Schema {
  @type({ map: ShipState }) ships = new MapSchema<ShipState>()
}
