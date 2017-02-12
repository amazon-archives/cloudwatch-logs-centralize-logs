'use strict';

const aws = require('aws-sdk');
var zlib = require('zlib');
const s3 = new aws.S3({ apiVersion: '2006-03-01' });
const cloudWatchLogs = new aws.CloudWatchLogs({
    apiVersion: '2014-03-28'
});

const readline = require('readline');
const stream = require('stream');

//specifying the log group and the log stream name for CloudWatch Logs
const logGroupName = 'apache-elb-logs' //Name of the log group goes here;
const logStreamName = 'apache-elb-stream' //Name of the log stream goes here;

exports.handler = (event, context, callback) => {

    // Get the object from the event and show its content type
    console.log('S3 object is:', event.Records[0].s3);
    const bucket = event.Records[0].s3.bucket.name;
    console.log('Name of S3 bucket is:', bucket);
    const key = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, ' '));
    const params = {
        Bucket: bucket,
        Key: key,
    };
    s3.getObject(params, (err, data) => {
        if (err) {
            console.log(err);
            const message = `Error getting object ${key} from bucket ${bucket}. Make sure they exist and your bucket is in the same region as this function.`;
            console.log(message);
            callback(message);
        } else {
            //uncompressing the S3 data
            zlib.gunzip(data.Body, function(error, buffer){
            if (error) {
                console.log('Error uncompressing data', error);
                return;
            }

            var logData = buffer.toString('ascii');
            //manage the log group, streams and push log events to CloudWatch Logs
            manageLogGroups(logData);            
                
            });
            callback(null, data.ContentType);
        }
    });
    
    //Manage the log group
    function manageLogGroups (logData) {
        
        var describeLogGroupParams = {
            logGroupNamePrefix: logGroupName  
        };
        
        //check if the log group already exists
        cloudWatchLogs.describeLogGroups(describeLogGroupParams, function (err, data){
            if (err) {
                console.log('Error while describing log group:', err);
                createLogGroup (logData);
            } else {
                if (!data.logGroups[0]) {
                    console.log ('Need to  create log group:', data);
                    //create log group
                    createLogGroup(logData);
                } else {
                    console.log('Success while describing log group:', data);
                    manageLogStreams(logData);
                }
            }
        });
    }
    
    //Create log group
    function createLogGroup (logData) {
        var logGroupParams = {
            logGroupName: logGroupName
        }
        cloudWatchLogs.createLogGroup(logGroupParams, function (err, data){
            if (err) {
                console.log('error while creating log group: ', err, err.stack);
                return;
            } else {
                console.log ('Success in creating log group: ', logGroupName);
                manageLogStreams(logData);
            }
        });
    }
    
    //Manage the log stream and get the sequenceToken
    function manageLogStreams (logData) {
        var describeLogStreamsParams = {
            logGroupName: logGroupName,
            logStreamNamePrefix: logStreamName 
        }
        
        //check if the log stream already exists and get the sequenceToken
        cloudWatchLogs.describeLogStreams (describeLogStreamsParams, function (err, data) {
            if (err) {
                console.log ('Error during describe log streams:', err);
                //create log stream
                createLogStream(logData);
            } else {
                if (!data.logStreams[0]) {
                    console.log ('Need to  create log stream:', data);
                    //create log stream
                    createLogStream(logData);
                } else {
                    console.log ('Log Stream already defined:', logStreamName);
                    putLogEvents (data.logStreams[0].uploadSequenceToken, logData);
                }
            }
        });
    }
    
    //Create Log Stream
    function createLogStream (logData) {
        var logStreamParams = {
            logGroupName: logGroupName,
            logStreamName: logStreamName
        };
        
        cloudWatchLogs.createLogStream(logStreamParams, function (err, data){
            if (err) {
                console.log('error while creating log stream: ', err, err.stack);
                    return;
            } else {
                console.log ('Success in creating log stream: ', logStreamName);
                putLogEvents (null, logData);
            }
        });
    }
    
    function putLogEvents (sequenceToken, logData) {
        //From http://docs.aws.amazon.com/AmazonCloudWatchLogs/latest/APIReference/API_PutLogEvents.html
        const MAX_BATCH_SIZE = 1048576; // maximum size in bytes of Log Events (with overhead) per invocation of PutLogEvents
        const MAX_BATCH_COUNT = 10000; // maximum number of Log Events per invocation of PutLogEvents
        const LOG_EVENT_OVERHEAD = 26; // bytes of overhead per Log Event

        // holds a list of batches
        var batches = [];

        // holds the list of events in current batch
        var batch = [];

        // size of events in the current batch
        var batch_size = 0;

        var bufferStream = new stream.PassThrough();
        bufferStream.end(logData);

        var rl = readline.createInterface({
            input: bufferStream
        });

        var line_count = 0;

        rl.on('line', (line) => {
            ++line_count;

            var ts = line.split(' ', 2)[1];
            var tval = Date.parse(ts);

            var event_size = line.length + LOG_EVENT_OVERHEAD;

            batch_size += event_size;

            if(batch_size >= MAX_BATCH_SIZE ||
                batch.length >= MAX_BATCH_COUNT) {
                // start a new batch
                batches.push(batch);
                batch = [];
                batch_size = event_size;
            }

            batch.push({
                message: line,
                timestamp: tval
            });
        });

        rl.on('close', () => {
            // add the final batch
            batches.push(batch);
            sendBatches(sequenceToken, batches);
        });
    }
    
    function sendBatches(sequenceToken, batches) {
        var count = 0;
        var batch_count = 0;

        function sendNextBatch(err, nextSequenceToken) {
            if(err) {
                console.log('Error sending batch: ', err, err.stack);
                return;
            } else {
                var nextBatch = batches.shift();
                if(nextBatch) {
                    // send this batch
                    ++batch_count;
                    count += nextBatch.length;
                    sendBatch(nextSequenceToken, nextBatch, sendNextBatch);
                } else {
                    // no more batches: we are done
                    var msg = `Successfully put ${count} events in ${batch_count} batches`;
                    console.log(msg);
                    callback(null, msg);
                }
            }
        }

        sendNextBatch(null, sequenceToken);
    }

    function sendBatch(sequenceToken, batch, doNext) {
        var putLogEventParams = {
            logEvents: batch,
            logGroupName: logGroupName,
            logStreamName: logStreamName
        }
        if (sequenceToken) {
            putLogEventParams['sequenceToken'] = sequenceToken;
        }

        // sort the events in ascending order by timestamp as required by PutLogEvents
        putLogEventParams.logEvents.sort(function(a, b) {
            if(a.timestamp > b.timestamp) {
                return 1;
            }
            if(a.timestamp < b.timestamp) {
                return -1;
            }
            return 0;
        });

        cloudWatchLogs.putLogEvents (putLogEventParams, function (err, data) {
            if (err) {
                console.log('Error during put log events: ', err, err.stack);
                doNext(err, null);
            } else {
                console.log(`Success in putting ${putLogEventParams.logEvents.length} events`);
                doNext(null, data.nextSequenceToken);
            }
        });
    }
};