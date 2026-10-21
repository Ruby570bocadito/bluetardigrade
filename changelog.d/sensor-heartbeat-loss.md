- **The heartbeat reports what ETW lost.** Every minute the sensor asks both
  ETW sessions how many events and real-time buffers they lost
  (`ControlTraceW`, session query) and sends the totals in the heartbeat
  (`etw_events_lost`, `etw_buffers_lost`), together with the count of process
  starts that went out without their SHA-256 because the image-hash thread
  could not take them (`hash_dropped`; hashing off by `--no-hash` does not
  count). A sensor that silently loses telemetry now shows up in the machine
  inventory instead of only in a log line.
