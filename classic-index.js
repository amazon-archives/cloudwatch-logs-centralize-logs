'use strict';

const aws = require('aws-sdk');
var zlib = require('zlib');
const s3 = new aws.S3({ apiVersion: '2006-03-01' });
const cloudWatchLogs = new aws.CloudWatchLogs({
    apiVersion: '2014-03-28'
});

//specifying the log group and the log stream name for CloudWatch Logs
const logGroupName = 'classic-elb-logs' //Name of the log group goes here;
const logStreamName = 'classic-elb-stream' //Name of the log stream goes here;

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
            console.log('Data is:', data);
            if (data.Body) {
                var logData = data.Body.toString('ascii');
                //manage the log group, streams and push log events to CloudWatch Logs
                manageLogGroups(logData);
            }
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
    
    //Put log events in CloudWatch Logs
    function putLogEvents (sequenceToken, logData) {
        var putLogEventParams = {
            logEvents: [ {
                message: logData,
                timestamp: Date.now()
            }],
            logGroupName: logGroupName,
            logStreamName: logStreamName
        }
        if (sequenceToken) {
            putLogEventParams['sequenceToken'] = sequenceToken;
        }
        
        cloudWatchLogs.putLogEvents (putLogEventParams, function (err, data) {
            if (err) {
                console.log('Error during put log events: ', err, err.stack);
                return;
            } else {
                console.log('Success in putting log events: ', data);
            } 
        });
    }
};
