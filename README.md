# Cloudwatch Logs Centralize Logs

### Package cloudwatch-logs-centralize-logs

Copyright 2016- Amazon.com, Inc. or its affiliates. All Rights Reserved.

## Introduction

It is often useful to centralize log data from different sources as it gets generated. Data can then be used for searching, filtering or doing analysis. The **CloudWatch Logs Centralize Logs** is a Lambda function that helps in centralizing logs from Elastic Load Balancing (ELB) using Amazon S3 bucket triggers. In this lambda function we have showed how ELB logs that are delivered to S3 can be posted to CloudWatch Logs. But it can be modified to read any logs from S3.

## Flow of Events

![Flow of events](https://s3.amazonaws.com/aws-cloudwatch/downloads/cloudwatch-logs-centralize-logs/Demo-1.png)

## Setup Overview

Lambda function is written in Node.js. Since we don't have a dependency on a specific version of library, we rely on the defaults provided by Lambda. Correspoindingly a Lambda deployment package is not required. Instead we can use the inline editor in Lambda. You can create a new Lambda function, and copy the code in index.js in this repository to your function.

### Pre-requisite

* S3 bucket where ELB logs can be archived to.
* Enable archiving of ELB access logs in S3.


### Triggers

* The Lambda function is triggered at an S3 'ObjectCreated' event type
* You need to also provide the S3 bucket where the ELB logs will be delivered

### Authorization

Since there is a need here for various AWS services making calls to each other, appropriate authorization is required.  This takes the form of configuring an IAM role, to which various authorization policies are attached.  This role will be assumed by the Lambda function when running. The below two permissions are required:
 
1.S3 permits Lambda to fetch the created objects from a given bucket

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:GetObject"
            ],
            "Resource": "arn:aws:s3:::*"
        }
    ]
}
```

2.CloudWatch Logs permits Lambda to perform various operations. Below we have given Full Access to CloudWatch logs. You can choose to give specific access to describeLogStreams, describeLogGroups, createLogGroup, createLogStream, putLogEvents

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Action": [
        "logs:*"
      ],
      "Effect": "Allow",
      "Resource": "*"
    }
  ]
}
```

### Lambda Function

***Configurable parameters:***

* Log Group Name: Name of the log group in CloudWatch Logs in which the logs will be published
* Log Steram Name: Name of the log stream within the log group

***Instructions:***

* Handler: The name of the main code file. In this example we have used index as the name of the handler.
* The Lambda function reads the data from the S3 object using the S3 getObject API. The data is encoded and compresses.
* The Lambda function decodes and decompresses the data using the zlib library
* The data is then send to CloudWatch Logs using the putLogEvents api of CloudWatch Logs
  * We check for the existence of the specified log group and stream using the describeLogGroups and describeLogStreams. If        not found, we create the group and stream. 
  * When the log steam is existing, we use the sequenceToken during the putLogEvents call.
    
### Lambda Configuration

This Lambda function was created with runtime Node.js 4.3. It has been tested with 128 KB and 3 second timeout. No VPC was used. You can change the number based on your testing.

## Known Limitations

This Lambda function has the following limitation:
* Currently describeLogStreams is called at every Lambda invocation. But describeLogStreams has a limit of 5 transactions per second (TPS/account/region). This can be resolved by modifying the Lambda function to create log group and log stream only if we get a ResourceNotFound error from calling putLogEvents.
