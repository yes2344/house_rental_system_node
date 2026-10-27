# Property image watermarks

The Node API adds a translucent `@Infinity House` watermark to newly uploaded
property images. It stores an unmodified original separately in private
storage and serves that original only through the authorized image endpoint.

Existing images are not automatically regenerated when the watermark changes.
The Node backend does not include a bulk re-watermark command. Back up the
public and private media directories before any separately developed
maintenance operation; never overwrite private originals with watermarked
files.
