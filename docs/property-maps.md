# Property map status

The current React frontend and Node API do not provide a map picker, address
geocoder, or public coordinate display. Use the property's textual location
field for the public-facing area and avoid placing a private street address
there.

The database may contain legacy coordinate columns, but they are not exposed
or edited by the current API. The Node backend expects the existing database
schema and does not apply migrations during startup.
