import needle from 'needle'
import ImageResolver from 'image-resolver'
import htmlStripper from 'string-strip-html'
import read from 'node-readability'
import crypto from 'crypto'
import superagent from 'superagent'
import mime from 'mime'
import sharp from 'sharp'
import AWS from 'aws-sdk'
import { promisify } from 'util'

const { AWS_BUCKET_NAME, AWS_S3_REGION } = process.env

const s3Client = new AWS.S3({
  bucket: AWS_BUCKET_NAME,
  region: AWS_S3_REGION
})

let imageResolver = new ImageResolver()

imageResolver.register(new ImageResolver.Opengraph())
imageResolver.register(new ImageResolver.FileExtension())
imageResolver.register(new ImageResolver.MimeType())
imageResolver.register(new ImageResolver.Webpage())

const readability = promisify(read)

const imageGetter = (url) => new Promise(resolve => {
  imageResolver.resolve(url, (image) => {
    return resolve(image)
  })
})

export async function scrape (event, context, cb) {
  const url = event.query.url || event.body.url

  async function getArticle () {
    var newArticle = {
      images: [],
      format: 'read',
      processing: true,
      url: url,
      stream: 'news'
    }

    const response = await needle('get', url, {
      compressed: true,
      follow_max: 3
    })

    const article = await readability(response.body)

    const description = htmlStripper(article.content || '').substring(0, 400)

    newArticle.title = article.title
    newArticle.description = description
    newArticle.content = article.content

    const result = await imageGetter(url)

    if ( !result ) {
     newArticle.images.push({
       orig: null,
       hash: null,
       thumb: null
     })

     return newArticle
    }

    try {
      const sizes = await saveImage(result.image)
      newArticle.images.push(sizes)
      article.close()

      return newArticle
    } catch (error) {
      throw error
    }
  }

  try {
    const article = await getArticle()

    cb(null, { data: article })

    // await replaceImages(article)
  } catch (e) {
    throw e
  }
}

const makeFullUrl = (key) => (
  `https://s3-${AWS_S3_REGION}.amazonaws.com/${AWS_BUCKET_NAME}/${key}`
)

const checkImageSize = async (data) => {
  const { width, height } = await sharp(data).metadata()

  if (height < 10 || width < 10) {
    throw new Error('Image too small.')
  }

  return true
}

const saveOrig = (imageUrl ) => new Promise(async function (resolve, reject) {
  let url = imageUrl
  var imgType = mime.lookup( imageUrl )

  var image = {
    type: imgType,
    extension: mime.extension( imgType )
  }

  if ( imageUrl.indexOf( "/" ) === 0 ) {
    url = "https:" + imageUrl
  }

  try {
    const imageData = await superagent.get(url)
    await checkImageSize(imageData.body)

    const resized = await sharp(imageData.body)
      .resize(1340, undefined, { withoutEnlargement: false })
      .toBuffer()

    image.hash = crypto.createHash('md5').update(resized).digest('hex')

    const key = image.hash + "-orig." + image.extension

    const params = {
      Bucket: AWS_BUCKET_NAME,
      Key: key,
      Body: resized,
      ACL: 'public-read',
      ContentType: mime.lookup(image.extension)
    }

    s3Client.putObject(params, (err) => {
      if ( err ) return reject( new Error( err ) )

      image.orig = makeFullUrl(key)

      return resolve(image)
    })

    // .format(( err, value ) => {
    //   if ( err ) return reject( new Error( "Could not determine format for image" ) )

    //   image.extension = value
    //   image.type = mime.lookup( image.extension )
    // })
  } catch (error) {
    console.error(error)

    // TODO: The placeholder should be a path to a static asset on the front-end so design can easily change it. Or just place no image in the DB.
    return resolve({
      ...image,
      orig: undefined
    })
  }
})

/* Saves a thumbnail

TODO: Limit animated GIFS and request full image from external http again
*/
async function saveThumb ( image ) {
  const imageData = await superagent.get( image.orig )

  const thumbnail = await sharp(imageData.body)
    .crop(sharp.strategy.entropy)
    .resize(400, 224)
    .jpeg()
    .toBuffer()

  const key = image.hash + "-thumb.JPEG"
  const params = {
    Bucket: AWS_BUCKET_NAME,
    Key: key,
    Body: thumbnail,
    ACL: 'public-read',
    ContentType: 'image/jpeg'
  }

  s3Client.putObject(params, async (e) => {
    if (e) throw e

    return image
  })

  image.thumb = makeFullUrl(key)
  return image
}

 /*
 this module does it all. it creates an MD5 hash for an image, saves it to disk, creates and saves a thumbnail, etc

 Usage: saveImage( TYPE[STRING], IMAGE-URL[STIRNG] )

 Returns: promise with array of [ HASH, ORIGINALPATH, THUMBNAILPATH ]

 TODO: return a promise with an object of image.hash, image.originalPath, image.thumbnailPath
 */
async function saveImage ( imageUrl ) {
  try {
    const fullsize = await saveOrig(imageUrl)
    const image = await saveThumb(fullsize)

    return {
      hash: image.hash,
      orig: image.orig,
      thumb: image.thumb
    }
  } catch (e) {
    throw e
  }
}

